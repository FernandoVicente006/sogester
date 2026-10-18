-- Cancelamento de processos e gestão de exceções depois da autorização.
ALTER TABLE processes
  MODIFY status ENUM('SUBMETIDO','EM_ANALISE','REJEITADO','DOCUMENTOS_PENDENTES','DOCUMENTOS_SUBMETIDOS',
                     'AUTORIZACAO_EMITIDA','PAGAMENTO_PENDENTE','PAGAMENTO_SUBMETIDO','PAGAMENTO_CONFIRMADO',
                     'CONCLUIDO','CANCELADO') NOT NULL DEFAULT 'SUBMETIDO';

-- Depois da autorização, o transitário não cancela sozinho: pede, e a Sogester decide.
CREATE TABLE cancellation_requests (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id     INT UNSIGNED NOT NULL,
  requested_by   INT UNSIGNED NOT NULL,
  reason         VARCHAR(500) NOT NULL,
  status         ENUM('PENDENTE','APROVADO','RECUSADO') NOT NULL DEFAULT 'PENDENTE',
  decided_by     INT UNSIGNED NULL,
  decided_at     TIMESTAMP    NULL,
  decision_notes VARCHAR(500) NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cr_process   FOREIGN KEY (process_id)   REFERENCES processes(id),
  CONSTRAINT fk_cr_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_cr_decider   FOREIGN KEY (decided_by)   REFERENCES users(id),
  INDEX idx_cr_process (process_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Prorrogações do prazo de pagamento (exceção do administrador, sempre justificada e limitada).
CREATE TABLE commitment_extensions (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  commitment_id   INT UNSIGNED NOT NULL,
  extended_by     INT UNSIGNED NOT NULL,
  days            TINYINT UNSIGNED NOT NULL,
  reason          VARCHAR(500) NOT NULL,
  previous_due_at DATETIME NOT NULL,
  new_due_at      DATETIME NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ce_commitment FOREIGN KEY (commitment_id) REFERENCES payment_commitments(id),
  CONSTRAINT fk_ce_user       FOREIGN KEY (extended_by)   REFERENCES users(id),
  INDEX idx_ce_commitment (commitment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Autorizações revogáveis: a revogada fica registada e deixa de ser válida; só uma fica ativa por processo.
ALTER TABLE authorizations
  ADD COLUMN seq SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN revoked_at TIMESTAMP NULL,
  ADD COLUMN revoked_by INT UNSIGNED NULL,
  ADD COLUMN revoke_reason VARCHAR(500) NULL,
  ADD COLUMN active_key TINYINT GENERATED ALWAYS AS (IF(revoked_at IS NULL, 1, NULL)) STORED,
  ADD CONSTRAINT fk_auth_revoker FOREIGN KEY (revoked_by) REFERENCES users(id),
  ADD UNIQUE KEY uq_auth_active (process_id, active_key),
  DROP INDEX process_id;

ALTER TABLE payment_commitments ADD COLUMN extension_count TINYINT UNSIGNED NOT NULL DEFAULT 0;
