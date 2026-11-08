-- Inicialização única: depois de criado o super administrador, o /setup fecha para sempre.
CREATE TABLE system_setup (
  id           TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  completed_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_by INT UNSIGNED     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Instalações que já têm super administrador ficam inicializadas.
INSERT INTO system_setup (id, completed_by)
  SELECT 1, MIN(id) FROM users WHERE role = 'SUPER_ADMIN' HAVING COUNT(*) > 0;

-- Gestão de terminais delegada pelo super administrador.
ALTER TABLE users ADD COLUMN can_manage_terminals TINYINT(1) NOT NULL DEFAULT 0;
