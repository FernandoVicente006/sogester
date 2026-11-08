-- Operação do processo (desembarque usa EP17, embarque usa EP15) e documentos agrupados como na JUP.
ALTER TABLE processes
  ADD COLUMN operation ENUM('DESEMBARQUE','EMBARQUE') NULL AFTER cargo_priority;

ALTER TABLE process_documents
  MODIFY kind ENUM('BILHETE','ALVARA','GUIA_CABOTAGEM','BL','EP17','EP15','RECIBO_EP','DOCUMENTOS','OUTRO',
                   'PROFORMA','COMPROVATIVO','FATURA_RECIBO') NOT NULL;
