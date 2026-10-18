-- Último documento existente quando a Sogester pede documentos em falta; só os posteriores contam como novos.
-- (Comparar datas falhava quando o pedido e o anexo caíam no mesmo segundo.)
ALTER TABLE processes ADD COLUMN docs_baseline_id INT UNSIGNED NOT NULL DEFAULT 0;
