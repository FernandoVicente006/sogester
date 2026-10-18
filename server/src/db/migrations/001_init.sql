-- Entidades / terminais portuários (Sogester Cabinda, Soyo, Luanda).
-- Cada entidade é uma unidade independente; o MVP ativa apenas Cabinda.
CREATE TABLE entities (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(20)  NOT NULL UNIQUE,
  name         VARCHAR(120) NOT NULL,
  location     VARCHAR(120) NOT NULL,
  active       TINYINT(1)   NOT NULL DEFAULT 0,
  external_ref VARCHAR(100) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO entities (code, name, location, active) VALUES
  ('CABINDA', 'Sogester Cabinda', 'Cabinda', 1),
  ('SOYO',    'Sogester Soyo',    'Soyo',    0),
  ('LUANDA',  'Sogester Luanda',  'Luanda',  0);

-- Transitários (intermediários obrigatórios). Um transitário pode operar em várias entidades.
CREATE TABLE forwarders (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(160) NOT NULL,
  nif               VARCHAR(30)  NOT NULL UNIQUE,
  email             VARCHAR(160) NOT NULL,
  phone             VARCHAR(40)  NULL,
  location          VARCHAR(160) NOT NULL,
  logo_path         VARCHAR(255) NULL,
  extra_identifiers JSON         NULL,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  external_ref      VARCHAR(100) NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Utilizadores: staff Sogester (ligado a uma entidade) ou utilizador de transitário.
CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_id     INT UNSIGNED NULL,
  forwarder_id  INT UNSIGNED NULL,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('SUPER_ADMIN','ADMIN_ENTIDADE','LOJA','CADASTRO','FATURACAO','TRANSITARIO') NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  external_ref  VARCHAR(100) NULL,
  last_login_at TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_entity    FOREIGN KEY (entity_id)    REFERENCES entities(id),
  CONSTRAINT fk_users_forwarder FOREIGN KEY (forwarder_id) REFERENCES forwarders(id),
  INDEX idx_users_entity (entity_id),
  INDEX idx_users_forwarder (forwarder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vínculo transitário <-> entidade; cada entidade valida o transitário separadamente.
CREATE TABLE forwarder_entities (
  forwarder_id INT UNSIGNED NOT NULL,
  entity_id    INT UNSIGNED NOT NULL,
  status       ENUM('PENDENTE','APROVADO','REJEITADO','SUSPENSO') NOT NULL DEFAULT 'PENDENTE',
  notes        VARCHAR(500) NULL,
  reviewed_by  INT UNSIGNED NULL,
  reviewed_at  TIMESTAMP    NULL,
  external_ref VARCHAR(100) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (forwarder_id, entity_id),
  CONSTRAINT fk_fe_forwarder FOREIGN KEY (forwarder_id) REFERENCES forwarders(id),
  CONSTRAINT fk_fe_entity    FOREIGN KEY (entity_id)    REFERENCES entities(id),
  CONSTRAINT fk_fe_reviewer  FOREIGN KEY (reviewed_by)  REFERENCES users(id),
  INDEX idx_fe_entity_status (entity_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Auditoria de ações (base para o histórico de estados por processo).
CREATE TABLE audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_id   INT UNSIGNED NULL,
  user_id     INT UNSIGNED NULL,
  action      VARCHAR(60)  NOT NULL,
  target_type VARCHAR(40)  NOT NULL,
  target_id   VARCHAR(40)  NULL,
  details     JSON         NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_target (target_type, target_id),
  INDEX idx_audit_entity (entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
