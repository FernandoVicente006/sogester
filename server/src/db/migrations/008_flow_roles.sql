-- Novo fluxo: a autorização deixa de ser um passo do processo e a faturação fiscal fica fora da plataforma.
-- Perfis: Finanças de processos (substitui Faturação), Chefe comercial e Portaria.
ALTER TABLE users
  MODIFY role ENUM('SUPER_ADMIN','ADMIN_ENTIDADE','LOJA','CADASTRO','FATURACAO','FINANCAS','CHEFE_COMERCIAL','PORTARIA','TRANSITARIO') NOT NULL;
UPDATE users SET role = 'FINANCAS' WHERE role = 'FATURACAO';
ALTER TABLE users
  MODIFY role ENUM('SUPER_ADMIN','ADMIN_ENTIDADE','LOJA','CADASTRO','FINANCAS','CHEFE_COMERCIAL','PORTARIA','TRANSITARIO') NOT NULL;

-- Documentos conformes: a Sogester trata dos procedimentos internos até carregar a proforma.
ALTER TABLE processes
  MODIFY status ENUM('SUBMETIDO','EM_ANALISE','REJEITADO','DOCUMENTOS_PENDENTES','DOCUMENTOS_SUBMETIDOS',
                     'AUTORIZACAO_EMITIDA','EM_PROCESSAMENTO_INTERNO','PAGAMENTO_PENDENTE','PAGAMENTO_SUBMETIDO',
                     'PAGAMENTO_CONFIRMADO','CONCLUIDO','CANCELADO') NOT NULL DEFAULT 'SUBMETIDO';
UPDATE processes SET status = 'EM_PROCESSAMENTO_INTERNO' WHERE status = 'AUTORIZACAO_EMITIDA';
ALTER TABLE processes
  MODIFY status ENUM('SUBMETIDO','EM_ANALISE','REJEITADO','DOCUMENTOS_PENDENTES','DOCUMENTOS_SUBMETIDOS',
                     'EM_PROCESSAMENTO_INTERNO','PAGAMENTO_PENDENTE','PAGAMENTO_SUBMETIDO',
                     'PAGAMENTO_CONFIRMADO','CONCLUIDO','CANCELADO') NOT NULL DEFAULT 'SUBMETIDO';

-- A proforma é o ficheiro gerado no sistema de faturação da Sogester: os restantes dados são opcionais.
ALTER TABLE invoices
  MODIFY proforma_number   VARCHAR(40)   NULL,
  MODIFY amount            DECIMAL(16,2) NULL,
  MODIFY payment_entity    VARCHAR(40)   NULL,
  MODIFY payment_reference VARCHAR(60)   NULL;
