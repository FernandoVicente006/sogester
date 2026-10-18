-- Autorização digital, compromisso de pagamento (cargas perecíveis) e faturação manual do MVP.
ALTER TABLE process_documents
  MODIFY kind ENUM('BILHETE','ALVARA','GUIA_CABOTAGEM','BL','EP17','EP15','OUTRO',
                   'PROFORMA','COMPROVATIVO','FATURA_RECIBO') NOT NULL;

-- Compromisso formal de pagamento assinado pelo transitário (garantia da Sogester para saída antecipada).
CREATE TABLE payment_commitments (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id     INT UNSIGNED NOT NULL UNIQUE,
  signed_by      INT UNSIGNED NOT NULL,
  terms_version  VARCHAR(20)  NOT NULL,
  terms_text     TEXT         NOT NULL,
  signature_hash CHAR(64)     NOT NULL,
  ip             VARCHAR(45)  NULL,
  signed_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at         DATETIME     NULL, -- prazo para liquidar, definido quando a autorização é emitida
  CONSTRAINT fk_pc_process FOREIGN KEY (process_id) REFERENCES processes(id),
  CONSTRAINT fk_pc_user    FOREIGN KEY (signed_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Termo de autorização digital: o código é assinado (HMAC) e verificável publicamente.
CREATE TABLE authorizations (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id    INT UNSIGNED NOT NULL UNIQUE,
  type          ENUM('PADRAO','SAIDA_ANTECIPADA') NOT NULL,
  code          VARCHAR(32)  NOT NULL UNIQUE,
  commitment_id INT UNSIGNED NULL,
  issued_by     INT UNSIGNED NOT NULL,
  issued_at     DATETIME(3)  NOT NULL,
  notes         VARCHAR(500) NULL,
  external_ref  VARCHAR(100) NULL,
  CONSTRAINT fk_auth_process    FOREIGN KEY (process_id)    REFERENCES processes(id),
  CONSTRAINT fk_auth_commitment FOREIGN KEY (commitment_id) REFERENCES payment_commitments(id),
  CONSTRAINT fk_auth_user       FOREIGN KEY (issued_by)     REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dados de faturação do processo (proforma → comprovativo → confirmação → fatura recibo).
CREATE TABLE invoices (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id           INT UNSIGNED NOT NULL UNIQUE,
  proforma_number      VARCHAR(40)   NOT NULL,
  amount               DECIMAL(16,2) NOT NULL,
  currency             CHAR(3)       NOT NULL DEFAULT 'AOA',
  payment_entity       VARCHAR(40)   NOT NULL,
  payment_reference    VARCHAR(60)   NOT NULL,
  proforma_issued_by   INT UNSIGNED  NOT NULL,
  proforma_issued_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proof_submitted_at   TIMESTAMP     NULL,
  payment_confirmed_by INT UNSIGNED  NULL,
  payment_confirmed_at TIMESTAMP     NULL,
  receipt_number       VARCHAR(40)   NULL,
  receipt_issued_by    INT UNSIGNED  NULL,
  receipt_issued_at    TIMESTAMP     NULL,
  external_ref         VARCHAR(100)  NULL, -- liga ao sistema de faturação da Sogester no futuro
  CONSTRAINT fk_inv_process   FOREIGN KEY (process_id)           REFERENCES processes(id),
  CONSTRAINT fk_inv_issuer    FOREIGN KEY (proforma_issued_by)   REFERENCES users(id),
  CONSTRAINT fk_inv_confirmer FOREIGN KEY (payment_confirmed_by) REFERENCES users(id),
  CONSTRAINT fk_inv_receipt   FOREIGN KEY (receipt_issued_by)    REFERENCES users(id),
  INDEX idx_inv_reference (payment_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
