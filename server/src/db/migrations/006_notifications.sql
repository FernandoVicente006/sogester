-- Notificações dentro da plataforma, com entrega por e-mail (fila com tentativas) e preferência por utilizador.
ALTER TABLE users ADD COLUMN email_notifications TINYINT(1) NOT NULL DEFAULT 1;

CREATE TABLE notifications (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL,
  type           VARCHAR(40)  NOT NULL,
  title          VARCHAR(160) NOT NULL,
  body           VARCHAR(500) NULL,
  process_id     INT UNSIGNED NULL,
  read_at        TIMESTAMP    NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NONE: sem e-mail (desativado, preferência ou só in-app); PENDING: por enviar; SENT; FAILED: esgotou tentativas
  email_status   ENUM('NONE','PENDING','SENT','FAILED') NOT NULL DEFAULT 'NONE',
  email_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  email_error    VARCHAR(255) NULL,
  email_sent_at  TIMESTAMP    NULL,
  CONSTRAINT fk_notif_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_notif_process FOREIGN KEY (process_id) REFERENCES processes(id),
  INDEX idx_notif_user (user_id, read_at, id),
  INDEX idx_notif_email (email_status, id),
  INDEX idx_notif_process (process_id, type, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lembrete 24 h antes e alerta de atraso, enviados uma única vez por compromisso.
ALTER TABLE payment_commitments
  ADD COLUMN reminder_sent_at TIMESTAMP NULL,
  ADD COLUMN overdue_notified_at TIMESTAMP NULL;
