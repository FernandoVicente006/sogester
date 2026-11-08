-- Dados de transporte do processo (como na nota da JUP) e listas de veículos, contentores e mercadorias.
-- Um processo pode misturar tipos (por exemplo, carga geral dentro de um carro).
ALTER TABLE processes
  MODIFY volume_type ENUM('ALTO','AUTO','CARGA_GRANEL','CARGA_GERAL','CONTENTOR') NOT NULL;
UPDATE processes SET volume_type = 'AUTO' WHERE volume_type = 'ALTO';
ALTER TABLE processes
  MODIFY volume_type ENUM('AUTO','CARGA_GRANEL','CARGA_GERAL','CONTENTOR') NOT NULL,
  -- obrigatórios na submissão; nulos só em processos anteriores a esta versão
  ADD COLUMN bl_number           VARCHAR(60)  NULL AFTER cargo_category,
  ADD COLUMN du_number           VARCHAR(60)  NULL AFTER bl_number,
  ADD COLUMN vessel_name         VARCHAR(120) NULL AFTER du_number,
  ADD COLUMN voyage_number       VARCHAR(40)  NULL AFTER vessel_name,
  ADD COLUMN discharge_type      ENUM('DIRECTA','INDIRECTA') NULL AFTER voyage_number,
  ADD COLUMN regime              VARCHAR(10)  NULL AFTER discharge_type,
  ADD COLUMN manifest_number     VARCHAR(60)  NULL AFTER regime,
  ADD COLUMN packages_count      INT UNSIGNED NULL AFTER manifest_number,
  ADD COLUMN origin_country      VARCHAR(80)  NULL AFTER packages_count,
  ADD COLUMN destination_country VARCHAR(80)  NULL AFTER origin_country;

CREATE TABLE process_vehicles (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id  INT UNSIGNED NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL,
  chassis     VARCHAR(40)  NULL,
  brand       VARCHAR(80)  NOT NULL,
  model       VARCHAR(80)  NOT NULL,
  tariff_code VARCHAR(20)  NULL,
  fuel        VARCHAR(40)  NULL,
  CONSTRAINT fk_pv_process FOREIGN KEY (process_id) REFERENCES processes(id),
  INDEX idx_pv_process (process_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE process_containers (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id  INT UNSIGNED NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL,
  number      VARCHAR(20)  NOT NULL,
  size        ENUM('20','40','45') NULL,
  type        VARCHAR(40)  NULL,
  load_status ENUM('CHEIO','VAZIO') NULL,
  seal        VARCHAR(40)  NULL,
  packages    INT UNSIGNED NULL,
  weight_kg   DECIMAL(14,3) NULL,
  CONSTRAINT fk_pc2_process FOREIGN KEY (process_id) REFERENCES processes(id),
  INDEX idx_pcont_process (process_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE process_goods (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id   INT UNSIGNED NOT NULL,
  position     SMALLINT UNSIGNED NOT NULL,
  description  VARCHAR(255) NOT NULL,
  tariff_code  VARCHAR(20)  NULL,
  unit         VARCHAR(30)  NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  weight_kg    DECIMAL(14,3) NULL,
  vehicle_id   INT UNSIGNED NULL, -- mercadoria transportada dentro deste veículo
  container_id INT UNSIGNED NULL, -- ou dentro deste contentor
  CONSTRAINT fk_pg_process   FOREIGN KEY (process_id)   REFERENCES processes(id),
  CONSTRAINT fk_pg_vehicle   FOREIGN KEY (vehicle_id)   REFERENCES process_vehicles(id),
  CONSTRAINT fk_pg_container FOREIGN KEY (container_id) REFERENCES process_containers(id),
  INDEX idx_pg_process (process_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dados antigos (um só veículo, contentor ou mercadoria) passam para as listas.
INSERT INTO process_vehicles (process_id, position, brand, model)
  SELECT id, 1, vehicle_brand, vehicle_model FROM processes WHERE vehicle_brand IS NOT NULL;
INSERT INTO process_containers (process_id, position, number, type, weight_kg)
  SELECT id, 1, container_plate, container_type, container_weight_kg FROM processes WHERE container_plate IS NOT NULL;
INSERT INTO process_goods (process_id, position, description, unit, quantity, weight_kg)
  SELECT id, 1, description, 'Unidade', COALESCE(quantity, 1), weight_kg FROM processes WHERE description IS NOT NULL AND quantity IS NOT NULL;
UPDATE processes SET weight_kg = container_weight_kg WHERE weight_kg IS NULL AND container_weight_kg IS NOT NULL;

ALTER TABLE processes
  DROP COLUMN quantity,
  DROP COLUMN vehicle_brand,
  DROP COLUMN vehicle_model,
  DROP COLUMN container_plate,
  DROP COLUMN container_type,
  DROP COLUMN container_volume,
  DROP COLUMN container_weight_kg;
