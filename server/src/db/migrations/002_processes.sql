-- Clientes finais (donos da carga), registados pelo transitário.
-- O mesmo documento (BI ou NIF) é reconhecido automaticamente nas submissões seguintes.
CREATE TABLE clients (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  forwarder_id    INT UNSIGNED NOT NULL,
  type            ENUM('SINGULAR','EMPRESA') NOT NULL,
  name            VARCHAR(160) NOT NULL,
  document_number VARCHAR(40)  NOT NULL,
  is_foreign      TINYINT(1)   NOT NULL DEFAULT 0,
  phone           VARCHAR(40)  NULL,
  email           VARCHAR(160) NULL,
  address         VARCHAR(255) NULL,
  external_ref    VARCHAR(100) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_clients_forwarder FOREIGN KEY (forwarder_id) REFERENCES forwarders(id),
  UNIQUE KEY uq_clients_doc (forwarder_id, document_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE processes (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reference           VARCHAR(30)  NULL UNIQUE,
  entity_id           INT UNSIGNED NOT NULL,
  forwarder_id        INT UNSIGNED NOT NULL,
  client_id           INT UNSIGNED NOT NULL,
  created_by          INT UNSIGNED NOT NULL,
  status              ENUM('SUBMETIDO','EM_ANALISE','REJEITADO','DOCUMENTOS_PENDENTES','DOCUMENTOS_SUBMETIDOS',
                           'AUTORIZACAO_EMITIDA','PAGAMENTO_PENDENTE','PAGAMENTO_SUBMETIDO','PAGAMENTO_CONFIRMADO',
                           'CONCLUIDO') NOT NULL DEFAULT 'SUBMETIDO',
  cargo_priority      ENUM('NAO_PRIORITARIO','PERECIVEL','DESCARGA_DIRETA','CARGA_PERIGOSA') NOT NULL,
  priority_rank       TINYINT UNSIGNED NOT NULL,
  urgency_requested   TINYINT(1)   NOT NULL DEFAULT 0,
  urgency_reason      VARCHAR(500) NULL,
  volume_type         ENUM('ALTO','CARGA_GRANEL','CARGA_GERAL','CONTENTOR') NOT NULL,
  cargo_category      VARCHAR(100) NULL,
  description         VARCHAR(1000) NULL,
  quantity            DECIMAL(14,3) NULL,
  weight_kg           DECIMAL(14,3) NULL,
  vehicle_brand       VARCHAR(80)  NULL,
  vehicle_model       VARCHAR(80)  NULL,
  container_plate     VARCHAR(30)  NULL,
  container_type      VARCHAR(60)  NULL,
  container_volume    DECIMAL(10,3) NULL,
  container_weight_kg DECIMAL(14,3) NULL,
  status_notes        VARCHAR(500) NULL,
  submitted_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  external_ref        VARCHAR(100) NULL,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_entity    FOREIGN KEY (entity_id)    REFERENCES entities(id),
  CONSTRAINT fk_proc_forwarder FOREIGN KEY (forwarder_id) REFERENCES forwarders(id),
  CONSTRAINT fk_proc_client    FOREIGN KEY (client_id)    REFERENCES clients(id),
  CONSTRAINT fk_proc_creator   FOREIGN KEY (created_by)   REFERENCES users(id),
  INDEX idx_proc_queue (entity_id, status, urgency_requested, priority_rank, submitted_at),
  INDEX idx_proc_forwarder (forwarder_id, submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Documentos anexados; só se acedem por endpoint autenticado (nunca por URL estática).
CREATE TABLE process_documents (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id    INT UNSIGNED NOT NULL,
  kind          ENUM('BILHETE','ALVARA','GUIA_CABOTAGEM','BL','EP17','EP15','OUTRO') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(100) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  uploaded_by   INT UNSIGNED NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pdoc_process  FOREIGN KEY (process_id)  REFERENCES processes(id),
  CONSTRAINT fk_pdoc_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_pdoc_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Histórico de estados por processo.
CREATE TABLE process_status_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id  INT UNSIGNED NOT NULL,
  from_status VARCHAR(30)  NULL,
  to_status   VARCHAR(30)  NOT NULL,
  changed_by  INT UNSIGNED NOT NULL,
  notes       VARCHAR(500) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_psh_process FOREIGN KEY (process_id) REFERENCES processes(id),
  CONSTRAINT fk_psh_user    FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_psh_process (process_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
