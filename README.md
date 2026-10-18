# Sogester — Gestão de Processos

Camada digital entre transitários e a Sogester (terminais de Cabinda, Soyo e Luanda). Especificação: página
"Sistema de Gestão de Processos - Sogester" no Notion. Stack: React (Vite) + Node/Express + MySQL.

## Estado

- Passo 1: entidades/terminais, perfis de acesso e registo de transitários.
- Passo 2: submissão de processos (cliente, carga, documentos), fila por prioridade, análise pela Loja
  (SUBMETIDO → EM_ANALISE → DOCUMENTOS_PENDENTES/REJEITADO) e histórico de estados.
- Passo 3: autorização digital (código assinado com HMAC, verificável em `/verificar/:código`), compromisso de
  pagamento para perecíveis (saída antecipada) e faturação manual: proforma → comprovativo → confirmação → fatura
  recibo (AUTORIZACAO_EMITIDA → … → CONCLUIDO).
- Passo 4: chat por processo (Sogester ↔ transitário) com texto e anexos (PDF/PNG/JPG, até 3 por mensagem),
  visualizador embutido, mensagens não lidas por utilizador e conversa só de leitura em processos encerrados.
  A interface atualiza por polling (8 s); websockets/e-mail ficam para quando houver notificações.
- Design: sistema visual baseado em sogester.co.ao (azul institucional #054C83, âmbar de segurança, Poppins/Inter),
  painel com indicadores, indicador de progresso do processo, layout responsivo. Tokens em `web/src/styles.css`;
  o logótipo oficial (versão negativa, de sogester.co.ao) está em `web/public/logo-sogester.png`.
- Próximo: notificações (e-mail/push), relatórios e integração com o sistema da Sogester.

Salvaguardas de receita: carga perecível só é autorizada com compromisso assinado (palavra-passe); o prazo
(`PAYMENT_COMMITMENT_DAYS`, 3 por omissão) conta a partir da autorização; compromissos em atraso bloqueiam novos
compromissos do mesmo transitário. Pressupostos a confirmar com a Sogester: papéis que emitem a autorização (Loja e
administrador) e a proforma/recibo (Faturação e administrador), e a ordem da fila.

Fila (staff): urgência pedida → prioridade da carga (perecível, perigosa, descarga direta, restantes) → chegada.
Esta ordem é um pressuposto a confirmar com a Sogester (ver "Pontos em aberto" no Notion).

## Arranque

1. Base de dados: execute `setup-db.sql` (gerado localmente, fora do git) como root no MySQL do Laragon.
2. `cd server && npm install && npm start` — cria a base, aplica migrações e o super admin (`.env.example`).
3. `cd web && npm install && npm run dev` — http://localhost:5173 (proxy para a API na porta 3100).
4. Testes da API: `cd server && npm test` (usa a base `sogester_test`).

## Fluxo de inicialização

1. Super admin (`SEED_SUPERADMIN_*`) ativa as entidades (só Cabinda vem ativa).
2. Em `/setup`, o diretor-geral cria o seu acesso com o `SETUP_TOKEN`; fica vinculado ao terminal escolhido.
3. O administrador da entidade cria funcionários (Loja, Cadastro, Faturação) e o Cadastro regista transitários.
4. Cada entidade aprova/rejeita o transitário separadamente; um transitário pode operar em vários terminais.

## Decisões de desenho

- Todo o acesso a dados é filtrado pela entidade do utilizador (isolamento entre terminais).
- `external_ref` nas tabelas principais e `audit_log` preparam a integração futura com o sistema da Sogester.
- Regras de negócio em `server/src/services`, separadas das rotas (`server/src/routes/v1.js`); API versionada em `/api/v1`.
