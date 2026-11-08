-- Correções pedidas pela Loja: cada documento, documento em falta ou campo errado, com o motivo.
-- Ficam abertas até o transitário reenviar e guardam o histórico de cada ronda.
CREATE TABLE process_issues (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id        INT UNSIGNED NOT NULL,
  kind              ENUM('DOCUMENTO','EM_FALTA','CAMPO') NOT NULL,
  document_id       INT UNSIGNED NULL, -- documento recusado (DOCUMENTO)
  document_kind     VARCHAR(30)  NULL, -- tipo a enviar (DOCUMENTO e EM_FALTA)
  field             VARCHAR(40)  NULL, -- campo a corrigir (CAMPO)
  label             VARCHAR(200) NOT NULL,
  reason            VARCHAR(300) NOT NULL,
  created_by        INT UNSIGNED NOT NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fixed_at          TIMESTAMP    NULL, -- o transitário já corrigiu
  fixed_document_id INT UNSIGNED NULL,
  old_value         VARCHAR(255) NULL,
  new_value         VARCHAR(255) NULL,
  closed_at         TIMESTAMP    NULL, -- ronda encerrada (reenvio ou rejeição)
  CONSTRAINT fk_pi_process FOREIGN KEY (process_id) REFERENCES processes(id),
  CONSTRAINT fk_pi_user    FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_pi_open (process_id, closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
