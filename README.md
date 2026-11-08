# Sogester — Gestão de Processos

Camada digital entre transitários e a Sogester (terminais de Cabinda, Soyo e Luanda). Especificação: página
"Sistema de Gestão de Processos - Sogester" no Notion. Stack: React (Vite) + Node/Express + MySQL.

## Estado

- Passo 1: entidades/terminais, perfis de acesso e registo de transitários.
- Passo 2: submissão de processos (cliente, carga, documentos), fila por prioridade, análise pela Loja
  (SUBMETIDO → EM_ANALISE → DOCUMENTOS_PENDENTES/REJEITADO) e histórico de estados.
- Passo 3: autorização digital (código assinado com HMAC, verificável em `/verificar/:código`), compromisso de
  pagamento para perecíveis (saída antecipada) e faturação manual: proforma → comprovativo → confirmação → fatura
  recibo.
- Passo 4: chat por processo (Sogester ↔ transitário) com texto e anexos (PDF/PNG/JPG, até 3 por mensagem),
  visualizador embutido, mensagens não lidas por utilizador e conversa só de leitura em processos encerrados.
  A interface atualiza por polling (8 s); websockets/e-mail ficam para quando houver notificações.
- Design: sistema visual baseado em sogester.co.ao (azul institucional #054C83, âmbar de segurança, Poppins/Inter),
  painel com indicadores, indicador de progresso do processo, layout responsivo. Tokens em `web/src/styles.css`;
  o logótipo oficial (versão negativa, de sogester.co.ao) está em `web/public/logo-sogester.png`.
- Passo 5: notificações dentro da plataforma (sino, página e preferências) e por e-mail (SMTP, fila com tentativas).
  Avisam Loja/administrador de novas submissões e documentos reenviados, Finanças de proformas e comprovativos,
  transitários de cada mudança de estado, e todos dos prazos de pagamento (lembrete 24 h antes e alerta de atraso).
  Mensagens do chat agrupam-se numa notificação por destinatário. Configure `SMTP_*`, `MAIL_FROM` e `APP_URL`
  em `server/.env`; sem `SMTP_HOST` ficam só na plataforma.
- Passo 6: cancelamento e exceções. O transitário ou o administrador só cancelam até os documentos serem aprovados;
  depois da aprovação documental o processo segue até ao fim, e nunca se cancela com saída antecipada ativa (a dívida
  não se apaga). Exceções do administrador: revogar a saída antecipada (o código fica inválido), prorrogar o prazo de pagamento (máx. 2×, até 7 dias, sempre
  justificado) e reabrir processos rejeitados. Tudo fica no histórico/auditoria e o transitário é notificado.
- Passo 7: relatórios (/relatorios) com exportação CSV e impressão/PDF. Processos (estados, prioridades, tempos
  médios até autorizar e concluir; todo o pessoal), Receita (faturado, cobrado e em aberto por mês e transitário) e
  Atrasos (pagamentos vencidos e processos parados, com quem tem de agir; só administrador, Finanças e Chefe comercial). O CSV usa
  ";" e vírgula decimal (Excel PT), protege contra injeção de fórmulas e cada exportação fica auditada.
- Próximo: integração com o sistema da Sogester e preparação para produção.

Fluxo em vigor: a Loja analisa (EM_ANALISE), marca os documentos como conformes (EM_PROCESSAMENTO_INTERNO) e carrega a
proforma gerada no sistema de faturação da Sogester; o transitário envia o comprovativo; as Finanças de processos validam
e carregam a fatura recibo, e o processo conclui-se sozinho. As Finanças têm fila própria e comparam o comprovativo com a
proforma lado a lado; o transitário vê e descarrega os documentos e só avança com o comprovativo («Já paguei»). A plataforma não emite documentos fiscais: guarda e entrega
os ficheiros, e só o ficheiro é obrigatório (número, valor, entidade e referência são opcionais; proformas sem valor
ficam fora dos totais de receita). A saída antecipada é uma exceção paralela: não muda o estado do processo, é emitida
pelo administrador ou pelo Chefe comercial, exige compromisso assinado (palavra-passe) e o prazo
(`PAYMENT_COMMITMENT_DAYS`, 3 por omissão) conta a partir da emissão; compromissos em atraso bloqueiam novos compromissos
do mesmo transitário. Pressuposto a confirmar com a Sogester: a ordem da fila.

Fila (staff): urgência pedida → prioridade da carga (perecível, perigosa, descarga direta, restantes) → chegada.
Esta ordem é um pressuposto a confirmar com a Sogester (ver "Pontos em aberto" no Notion).

## Arranque

1. Base de dados: execute `setup-db.sql` (gerado localmente, fora do git) como root no MySQL do Laragon.
2. `cd server && npm install && npm start` — cria a base, aplica migrações e o super admin (`.env.example`).
3. `cd web && npm install && npm run dev` — http://localhost:5173 (proxy para a API na porta 3100).
4. Testes da API: `cd server && npm test` (usa a base `sogester_test`).

## Fluxo de inicialização

1. Inicialização única: em `/setup`, com o `SETUP_TOKEN` do `.env`, cria-se o administrador geral da Sogester.
   A partir daí o `/setup` fecha para sempre (fica registado na base de dados) e o token deve ser apagado do `.env`.
   Nenhuma palavra-passe fica no código: as dos utilizadores ficam só na base, cifradas com bcrypt, e os segredos do
   servidor (`JWT_SECRET`, `AUTHORIZATION_SECRET`, base de dados, SMTP) só no `.env` do servidor, fora do git.
2. O administrador geral cria os terminais (nascem inativos), os ativa e cria o administrador de cada terminal em
   Funcionários. Pode delegar a gestão de terminais a um funcionário ("Gere terminais").
3. O administrador da entidade cria funcionários (Loja, Cadastro, Finanças de processos, Chefe comercial, Portaria) e o Cadastro regista transitários.
4. Cada entidade aprova/rejeita o transitário separadamente; um transitário pode operar em vários terminais.

## Decisões de desenho

- Todo o acesso a dados é filtrado pela entidade do utilizador (isolamento entre terminais).
- `external_ref` nas tabelas principais e `audit_log` preparam a integração futura com o sistema da Sogester.
- Regras de negócio em `server/src/services`, separadas das rotas (`server/src/routes/v1.js`); API versionada em `/api/v1`.
