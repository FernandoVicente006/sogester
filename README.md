# Sogester — Gestão de Processos

Camada digital entre transitários e a Sogester (terminais de Cabinda, Soyo e Luanda). Especificação: página
"Sistema de Gestão de Processos - Sogester" no Notion. Stack: React (Vite) + Node/Express + MySQL.

## Estado

- Passo 1: entidades/terminais, perfis de acesso e registo de transitários.
- Passo 2: submissão de processos (cliente, carga, documentos), fila por prioridade, análise pela Loja
  (SUBMETIDO → EM_ANALISE → DOCUMENTOS_PENDENTES/REJEITADO) e histórico de estados.
- Próximo: autorização digital e faturação (AUTORIZACAO_EMITIDA → … → CONCLUIDO), chat, compromisso de pagamento
  para perecíveis.

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
