-- Arquivo: processos terminados saem da lista atual, mas ficam guardados e a numeração continua.
ALTER TABLE processes
  ADD COLUMN archived_at TIMESTAMP NULL,
  ADD INDEX idx_proc_archive (entity_id, archived_at);

UPDATE processes p
   SET archived_at = (SELECT MAX(h.created_at) FROM process_status_history h WHERE h.process_id = p.id)
 WHERE p.status IN ('CONCLUIDO', 'REJEITADO', 'CANCELADO');
