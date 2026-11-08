-- Saída antecipada como exceção: motivo, validade, aceite do transitário depois da emissão e uso único na portaria.
ALTER TABLE authorizations
  ADD COLUMN reason                   VARCHAR(500) NULL,
  ADD COLUMN valid_until              DATETIME     NULL,
  ADD COLUMN used_at                  TIMESTAMP    NULL,
  ADD COLUMN used_by                  INT UNSIGNED NULL,
  -- autorizações antigas assinavam o código com o compromisso; as novas são emitidas antes do aceite
  ADD COLUMN code_includes_commitment TINYINT(1)   NOT NULL DEFAULT 0,
  ADD CONSTRAINT fk_auth_used_by FOREIGN KEY (used_by) REFERENCES users(id);
UPDATE authorizations SET code_includes_commitment = 1;
