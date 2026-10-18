-- Chat por processo (Sogester <-> transitário) com anexos privados e controlo de leitura.
CREATE TABLE process_messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id INT UNSIGNED NOT NULL,
  sender_id  INT UNSIGNED NOT NULL,
  body       VARCHAR(4000) NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_process FOREIGN KEY (process_id) REFERENCES processes(id),
  CONSTRAINT fk_msg_sender  FOREIGN KEY (sender_id)  REFERENCES users(id),
  INDEX idx_msg_process (process_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE message_attachments (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id    BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(100) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  CONSTRAINT fk_att_message FOREIGN KEY (message_id) REFERENCES process_messages(id),
  INDEX idx_att_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Última mensagem lida por cada utilizador em cada processo (base das contagens de não lidas).
CREATE TABLE message_reads (
  user_id      INT UNSIGNED NOT NULL,
  process_id   INT UNSIGNED NOT NULL,
  last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, process_id),
  CONSTRAINT fk_read_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_read_process FOREIGN KEY (process_id) REFERENCES processes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
