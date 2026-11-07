import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'sogester_test';
process.env.SETUP_TOKEN = 'test-setup-token';
process.env.APP_URL = 'https://portal.test';

const { config } = await import('../src/config.js');
const { migrate } = await import('../src/db/migrate.js');
const { seed } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { setMailTransport } = await import('../src/services/mailer.js');
const { processOutbox, runPaymentChecks } = await import('../src/services/notifications.js');

let server;
let base;
const sent = [];
let failNext = 0;

async function api(method, path, { token, body, form, headers } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).body.token;
const PDF = () => new Blob(['%PDF-1.4 teste'], { type: 'application/pdf' });

function submission(extra = {}) {
  const fd = new FormData();
  fd.append(
    'data',
    JSON.stringify({
      entityId: 1,
      client: { type: 'SINGULAR', name: 'João', documentNumber: '004567890LA041' },
      cargoPriority: 'NAO_PRIORITARIO',
      volumeType: 'CARGA_GERAL',
      cargoCategory: 'Mercadoria fracionada',
      description: 'Caixas',
      quantity: 1,
      weightKg: 10,
      ...extra,
    }),
  );
  fd.append('ep17', PDF(), 'ep17.pdf');
  fd.append('bilhete', PDF(), 'bilhete.pdf');
  return fd;
}

function message(text) {
  const fd = new FormData();
  fd.append('text', text);
  return fd;
}

before(async () => {
  const { database, ...conn } = config.db;
  const root = await mysql.createConnection(conn);
  await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await root.end();
  await migrate({ log: () => {} });
  await seed({ log: () => {} });
  setMailTransport(async (m) => {
    if (failNext > 0) {
      failNext--;
      throw new Error('smtp indisponível');
    }
    sent.push(m);
  });
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  setMailTransport(null);
  server.close();
  await pool.end();
});

test('notificações: destinatários, e-mail, preferências, chat e prazos', async () => {
  // --- preparação
  await api('POST', '/setup/entity-admin', {
    body: { entityCode: 'CABINDA', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' },
    headers: { 'x-setup-token': 'test-setup-token' },
  });
  const admin = await login('dir@cabinda.ao', 'Senha1234');
  for (const [name, role] of [['Loja', 'LOJA'], ['Fat', 'FINANCAS']]) {
    await api('POST', '/users', { token: admin, body: { name, email: `${role.toLowerCase()}@cabinda.ao`, password: 'Senha1234', role } });
  }
  const loja = await login('loja@cabinda.ao', 'Senha1234');
  const fat = await login('financas@cabinda.ao', 'Senha1234');

  const mkForwarder = async (n) => {
    const r = await api('POST', '/forwarders', {
      token: admin,
      body: { name: `Transitário ${n}`, nif: `54170001${n}${n}`, email: `t${n}@t.ao`, location: 'Cabinda', user: { name: `U${n}`, email: `u${n}@t.ao`, password: 'Senha1234' } },
    });
    await api('PUT', `/forwarders/${r.body.forwarder.id}/entities/1`, { token: admin, body: { status: 'APROVADO' } });
    return login(`u${n}@t.ao`, 'Senha1234');
  };
  const fwdA = await mkForwarder(1);
  const fwdB = await mkForwarder(2);

  const superToken = await login(config.seed.superAdminEmail, config.seed.superAdminPassword);
  await api('PATCH', '/entities/2', { token: superToken, body: { active: true } });
  await api('POST', '/setup/entity-admin', {
    body: { entityCode: 'SOYO', name: 'Diretor Soyo', email: 'dir@soyo.ao', password: 'Senha1234' },
    headers: { 'x-setup-token': 'test-setup-token' },
  });
  const soyo = await login('dir@soyo.ao', 'Senha1234');

  const inbox = async (token, query = '') => (await api('GET', `/notifications${query}`, { token })).body;
  const emailsTo = (to) => sent.filter((m) => m.to === to);
  const step = async (token, path, expected, req = {}) => {
    const r = await api('POST', path, { token, ...req });
    assert.equal(r.status, expected, `${path}: ${JSON.stringify(r.body)}`);
    return r.body;
  };

  // --- nova submissão avisa a Loja e o administrador (não o transitário, nem outras entidades)
  const created = await api('POST', '/processes', { token: fwdA, form: submission() });
  const p = created.body.process;
  assert.equal((await inbox(loja)).unread, 1);
  assert.equal((await inbox(admin)).unread, 1);
  for (const t of [fat, fwdA, fwdB, soyo]) assert.equal((await inbox(t)).unread, 0);
  const first = (await inbox(loja)).notifications[0];
  assert.equal(first.type, 'PROCESS_SUBMITTED');
  assert.equal(first.processId, p.id);
  assert.match(first.title, new RegExp(p.reference));

  // --- leitura: individual, de outro utilizador e em massa
  assert.equal((await api('POST', `/notifications/${first.id}/read`, { token: fat })).status, 404);
  assert.equal((await api('POST', `/notifications/${first.id}/read`, { token: loja })).status, 204);
  assert.equal((await inbox(loja)).unread, 0);
  assert.equal((await inbox(admin, '?unread=1')).notifications.length, 1);
  assert.equal((await api('POST', '/notifications/read-all', { token: admin })).status, 204);
  assert.equal((await inbox(admin, '?unread=1')).notifications.length, 0);
  assert.equal((await api('GET', '/notifications')).status, 401);

  // --- e-mail: só depois do envio da fila, com link e texto escapado
  assert.equal(sent.length, 0);
  assert.deepEqual(await processOutbox(), { sent: 2, failed: 0, skipped: 0 });
  assert.deepEqual(sent.map((m) => m.to).sort(), ['dir@cabinda.ao', 'loja@cabinda.ao']);
  assert.deepEqual(await processOutbox(), { sent: 0, failed: 0, skipped: 0 }, 'não reenvia o que já foi enviado');

  await step(loja, `/processes/${p.id}/transition`, 200, { body: { status: 'EM_ANALISE' } });
  assert.equal((await inbox(loja)).notifications.at(0).type, 'PROCESS_SUBMITTED', 'quem age não se avisa a si próprio');
  assert.equal((await inbox(fwdA)).notifications[0].type, 'ANALYSIS_STARTED');
  await step(loja, `/processes/${p.id}/transition`, 200, { body: { status: 'DOCUMENTOS_PENDENTES', notes: '<b>BL</b> & "carta"' } });
  await processOutbox();
  const mail = emailsTo('u1@t.ao').at(-1);
  assert.match(mail.subject, /Documentos em falta/);
  assert.ok(mail.html.includes('https://portal.test/processos/' + p.id), 'link para o processo');
  assert.ok(mail.html.includes('&lt;b&gt;BL&lt;/b&gt; &amp; &quot;carta&quot;'), 'conteúdo escapado');
  assert.ok(!mail.html.includes('<b>BL</b>'));
  assert.match(mail.text, /portal\.test\/processos\//);

  // --- preferência: sem e-mail, mas com notificação na plataforma
  assert.equal((await api('GET', '/auth/me', { token: fwdA })).body.user.emailNotifications, true);
  assert.equal((await api('PATCH', '/auth/preferences', { token: fwdA, body: { emailNotifications: 'sim' } })).status, 400);
  assert.equal((await api('PATCH', '/auth/preferences', { token: fwdA, body: { emailNotifications: false } })).status, 200);
  assert.equal((await api('GET', '/auth/me', { token: fwdA })).body.user.emailNotifications, false);
  const docForm = new FormData();
  docForm.append('kind', 'BL');
  docForm.append('file', PDF(), 'bl.pdf');
  await step(fwdA, `/processes/${p.id}/documents`, 201, { form: docForm });
  await step(fwdA, `/processes/${p.id}/submit-documents`, 200);
  assert.equal((await inbox(loja)).notifications[0].type, 'DOCUMENTS_RESUBMITTED');
  await step(loja, `/processes/${p.id}/transition`, 200, { body: { status: 'EM_ANALISE' } }); // voltar à análise: sem aviso
  await step(loja, `/processes/${p.id}/transition`, 200, { body: { status: 'DOCUMENTOS_PENDENTES', notes: 'Falta a guia' } });
  const muted = (await inbox(fwdA)).notifications[0];
  assert.equal(muted.type, 'DOCUMENTS_REQUESTED');
  const [[row]] = await pool.query('SELECT email_status FROM notifications WHERE id = ?', [muted.id]);
  assert.equal(row.email_status, 'NONE');
  const before = emailsTo('u1@t.ao').length;
  await processOutbox();
  assert.equal(emailsTo('u1@t.ao').length, before);
  await api('PATCH', '/auth/preferences', { token: fwdA, body: { emailNotifications: true } });

  // --- chat: notificações agrupadas, e-mail só para o transitário, leitura ao abrir
  const unreadMsgs = async (token) => (await inbox(token)).notifications.filter((n) => n.type === 'MESSAGE' && !n.readAt);
  await step(loja, `/processes/${p.id}/messages`, 201, { form: message('Olá, pode enviar a guia?') });
  await step(loja, `/processes/${p.id}/messages`, 201, { form: message('Obrigado, aguardo.') });
  const grouped = await unreadMsgs(fwdA);
  assert.equal(grouped.length, 1, 'duas mensagens, uma notificação');
  assert.match(grouped[0].body, /Obrigado, aguardo/);
  await processOutbox();
  assert.equal(emailsTo('u1@t.ao').filter((m) => m.subject.startsWith('Nova mensagem')).length, 1);
  assert.equal((await unreadMsgs(admin)).length, 0, 'o remetente e quem não é destinatário não recebem');
  assert.equal((await api('POST', `/processes/${p.id}/messages/read`, { token: fwdA })).status, 204);
  assert.equal((await unreadMsgs(fwdA)).length, 0, 'abrir o chat marca como lida');

  await step(fwdA, `/processes/${p.id}/messages`, 201, { form: message('Segue a guia.') });
  for (const t of [loja, fat, admin]) assert.equal((await unreadMsgs(t)).length, 1);
  assert.equal((await unreadMsgs(soyo)).length, 0);
  const staffMail = sent.length;
  await processOutbox();
  assert.equal(sent.length, staffMail, 'mensagens do transitário não geram e-mail ao pessoal');

  // --- falhas de envio: tenta de novo e desiste ao fim do limite
  await step(loja, `/processes/${p.id}/transition`, 200, { body: { status: 'REJEITADO', notes: 'Documentação inválida' } });
  failNext = 1;
  assert.deepEqual(await processOutbox(), { sent: 0, failed: 1, skipped: 0 });
  const [[retry]] = await pool.query("SELECT email_status, email_attempts, email_error FROM notifications WHERE type = 'PROCESS_REJECTED'");
  assert.deepEqual([retry.email_status, retry.email_attempts, retry.email_error], ['PENDING', 1, 'smtp indisponível']);
  assert.deepEqual(await processOutbox(), { sent: 1, failed: 0, skipped: 0 });

  await api('POST', '/processes', { token: fwdA, form: submission() }); // 2 e-mails à Sogester
  failNext = 1000;
  for (let i = 0; i < config.mail.maxAttempts; i++) await processOutbox();
  const [[failed]] = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE email_status = 'FAILED'");
  assert.equal(failed.n, 2);
  failNext = 0;
  assert.deepEqual(await processOutbox(), { sent: 0, failed: 0, skipped: 0 }, 'falhados não voltam a ser tentados');

  // --- prazos de pagamento (carga perecível com compromisso)
  const per = (await api('POST', '/processes', { token: fwdA, form: submission({ cargoPriority: 'PERECIVEL', cargoCategory: 'Mercadoria frigorífica ou congelada', description: 'Peixe' }) })).body.process;
  await step(fwdA, `/processes/${per.id}/commitment`, 201, { body: { password: 'Senha1234', accept: true } });
  assert.equal((await unreadMsgs(admin)).length, 1);
  assert.ok((await inbox(admin)).notifications.some((n) => n.type === 'COMMITMENT_SIGNED'));
  await step(loja, `/processes/${per.id}/transition`, 200, { body: { status: 'EM_ANALISE' } });
  await step(admin, `/processes/${per.id}/authorization`, 201, { body: {} });
  assert.ok((await inbox(fat)).notifications.some((n) => n.type === 'AUTHORIZATION_ISSUED' && /saída antecipada/i.test(n.title)));
  assert.ok((await inbox(fwdA)).notifications.some((n) => n.type === 'AUTHORIZATION_ISSUED'));

  assert.deepEqual(await runPaymentChecks(), { dueSoon: 0, overdue: 0 }); // prazo de 3 dias: ainda longe
  await pool.query('UPDATE payment_commitments SET due_at = DATE_ADD(NOW(), INTERVAL 12 HOUR) WHERE process_id = ?', [per.id]);
  assert.deepEqual(await runPaymentChecks(), { dueSoon: 1, overdue: 0 });
  assert.deepEqual(await runPaymentChecks(), { dueSoon: 0, overdue: 0 }, 'lembrete só uma vez');
  assert.ok((await inbox(fwdA)).notifications.some((n) => n.type === 'PAYMENT_DUE_SOON'));

  await pool.query('UPDATE payment_commitments SET due_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE process_id = ?', [per.id]);
  assert.deepEqual(await runPaymentChecks(), { dueSoon: 0, overdue: 1 });
  assert.deepEqual(await runPaymentChecks(), { dueSoon: 0, overdue: 0 }, 'alerta de atraso só uma vez');
  for (const t of [fwdA, fat, admin]) assert.ok((await inbox(t)).notifications.some((n) => n.type === 'PAYMENT_OVERDUE'));
  assert.ok(!(await inbox(loja)).notifications.some((n) => n.type === 'PAYMENT_OVERDUE'), 'a Loja não trata de pagamentos');
  assert.ok(!(await inbox(fwdB)).notifications.some((n) => n.type === 'PAYMENT_OVERDUE'));
});
