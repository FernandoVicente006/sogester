import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'sogester_test';
process.env.SETUP_TOKEN = 'test-setup-token';

const { config } = await import('../src/config.js');
const { migrate } = await import('../src/db/migrate.js');
const { bootstrapMaster, createEntityAdmin } = await import('./bootstrap.js');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { runPaymentChecks } = await import('../src/services/notifications.js');

let server;
let base;

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
      operation: 'DESEMBARQUE', cargoPriority: 'NAO_PRIORITARIO',
      volumeType: 'CARGA_GERAL',
      cargoCategory: 'Mercadoria fracionada',
      description: 'Caixas',
      blNumber: 'BL-88626',
      duNumber: '2026R6028',
      vesselName: 'Tchiowa',
      voyageNumber: '12',
      dischargeType: 'INDIRECTA',
      weightKg: 10,
      goods: [{ description: 'Caixas', unit: 'Caixa', quantity: 1 }],
      ...extra,
    }),
  );
  fd.append('ep17', PDF(), 'ep17.pdf');
  fd.append('reciboEp', PDF(), 'recibo.pdf');
  fd.append('documentos', PDF(), 'documentos.pdf');
  return fd;
}

function file(field, data) {
  const fd = new FormData();
  if (data) fd.append('data', JSON.stringify(data));
  fd.append(field, PDF(), `${field}.pdf`);
  return fd;
}

before(async () => {
  const { database, ...conn } = config.db;
  const root = await mysql.createConnection(conn);
  await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await root.end();
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

test('cancelamento de processos e exceções após a autorização', async () => {
  const superToken = await bootstrapMaster(base);
  await createEntityAdmin(base, superToken, { entityCode: 'CABINDA', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' });
  const admin = await login('dir@cabinda.ao', 'Senha1234');
  for (const [name, role] of [['Loja', 'LOJA'], ['Fat', 'FINANCAS'], ['Chefe', 'CHEFE_COMERCIAL']]) {
    await api('POST', '/users', { token: admin, body: { name, email: `${role.toLowerCase()}@cabinda.ao`, password: 'Senha1234', role } });
  }
  const loja = await login('loja@cabinda.ao', 'Senha1234');
  const fat = await login('financas@cabinda.ao', 'Senha1234');
  const chefe = await login('chefe_comercial@cabinda.ao', 'Senha1234');

  const mkForwarder = async (n) => {
    const r = await api('POST', '/forwarders', {
      token: admin,
      body: { name: `T${n}`, nif: `54170001${n}${n}`, email: `t${n}@t.ao`, location: 'Cabinda', user: { name: `U${n}`, email: `u${n}@t.ao`, password: 'Senha1234' } },
    });
    await api('PUT', `/forwarders/${r.body.forwarder.id}/entities/1`, { token: admin, body: { status: 'APROVADO' } });
    return login(`u${n}@t.ao`, 'Senha1234');
  };
  const fwdA = await mkForwarder(1);
  const fwdB = await mkForwarder(2);

  await api('PATCH', '/entities/2', { token: superToken, body: { active: true } });
  await createEntityAdmin(base, superToken, { entityCode: 'SOYO', name: 'Diretor Soyo', email: 'dir@soyo.ao', password: 'Senha1234' });
  const soyo = await login('dir@soyo.ao', 'Senha1234');

  const submit = async (token, extra) => (await api('POST', '/processes', { token, form: submission(extra) })).body.process;
  const post = (token, id, path, body) => api('POST', `/processes/${id}${path}`, { token, body });
  const ok = async (token, id, path, body, expected = 200) => {
    const r = await post(token, id, path, body);
    assert.equal(r.status, expected, `${path}: ${JSON.stringify(r.body)}`);
    return r.body.process;
  };
  const code = async (token, id, path, body) => (await post(token, id, path, body)).body?.error?.code;
  const get = async (token, id) => (await api('GET', `/processes/${id}`, { token })).body.process;
  const inbox = async (token) => (await api('GET', '/notifications', { token })).body.notifications.map((n) => n.type);
  const approve = async (id) => {
    await ok(loja, id, '/transition', { status: 'EM_ANALISE' });
    return ok(loja, id, '/transition', { status: 'EM_PROCESSAMENTO_INTERNO' });
  };
  const proforma = (id, extra = {}) =>
    api('POST', `/processes/${id}/proforma`, {
      token: loja,
      form: file('proforma', { number: 'PF-1', amount: 1000, paymentEntity: '11111', paymentReference: '123456789', ...extra }),
    });
  const release = { reason: 'Avaria do pórtico da Sogester impede a saída normal', validDays: 2 };
  const proof = (id) => api('POST', `/processes/${id}/payment-proof`, { token: fwdA, form: file('proof') });

  // =========== cancelamento direto enquanto os documentos estão em análise ===========
  const p1 = await submit(fwdA);
  assert.equal(await code(fwdA, p1.id, '/cancellation', { reason: 'abc' }), 'VALIDATION_ERROR', 'motivo curto');
  assert.equal((await post(fwdB, p1.id, '/cancellation', { reason: 'Não é meu processo' })).status, 404);
  assert.equal((await post(loja, p1.id, '/cancellation', { reason: 'Quero cancelar' })).status, 403);
  const withdrawn = await ok(fwdA, p1.id, '/cancellation', { reason: 'Cliente desistiu da importação' });
  assert.equal(withdrawn.status, 'CANCELADO');
  assert.equal(withdrawn.statusNotes, 'Cliente desistiu da importação');
  assert.equal(withdrawn.history.at(-1).toStatus, 'CANCELADO');
  assert.ok((await inbox(loja)).includes('PROCESS_WITHDRAWN'));
  assert.equal(await code(fwdA, p1.id, '/cancellation', { reason: 'Outra vez, por favor' }), 'NOT_CANCELLABLE');
  const chat = new FormData();
  chat.append('text', 'olá');
  assert.equal((await api('POST', `/processes/${p1.id}/messages`, { token: loja, form: chat })).body.error.code, 'CHAT_CLOSED');
  assert.equal((await api('GET', '/processes/stats', { token: loja })).body.stats.cancelled, 1);
  assert.equal((await api('GET', '/processes/stats', { token: loja })).body.stats.active, 0);

  // =========== depois da aprovação documental já não se cancela ===========
  const p2 = await submit(fwdA);
  await approve(p2.id);
  assert.equal(await code(fwdA, p2.id, '/cancellation', { reason: 'O cliente cancelou o negócio' }), 'NOT_CANCELLABLE');
  assert.equal(await code(admin, p2.id, '/cancel', { reason: 'Cancelamento administrativo' }), 'NOT_CANCELLABLE');
  assert.equal((await get(admin, p2.id)).status, 'EM_PROCESSAMENTO_INTERNO');
  assert.equal((await post(fat, p2.id, '/cancellation/decision', { approve: true })).status, 404, 'já não há pedidos de cancelamento');

  const p3 = await submit(fwdA);
  await approve(p3.id);
  assert.equal((await proforma(p3.id)).status, 200);
  assert.equal(await code(fwdA, p3.id, '/cancellation', { reason: 'Quero cancelar a proforma' }), 'NOT_CANCELLABLE');
  assert.equal((await proof(p3.id)).status, 200);
  assert.equal(await code(admin, p3.id, '/cancel', { reason: 'Cancelamento administrativo' }), 'NOT_CANCELLABLE');
  await ok(fat, p3.id, '/confirm-payment', {});
  assert.equal(await code(fwdA, p3.id, '/cancellation', { reason: 'Já paguei mas desisti' }), 'NOT_CANCELLABLE');
  assert.equal(await code(admin, p3.id, '/cancel', { reason: 'Cancelamento administrativo' }), 'NOT_CANCELLABLE');

  // =========== saída antecipada: dívida não se apaga; prorrogação limitada ===========
  const per = await submit(fwdA);
  await ok(loja, per.id, '/transition', { status: 'EM_ANALISE' });
  const early = await ok(chefe, per.id, '/authorization', release, 201);
  await ok(fwdA, per.id, '/commitment', { password: 'Senha1234', accept: true }, 201);
  assert.equal(early.authorization.type, 'SAIDA_ANTECIPADA');
  assert.equal(await code(fwdA, per.id, '/cancellation', { reason: 'Quero cancelar a carga' }), 'EARLY_RELEASE_BINDING');
  assert.equal(await code(admin, per.id, '/cancel', { reason: 'Cancelamento administrativo' }), 'EARLY_RELEASE_BINDING');

  const ext = (token, body) => post(token, per.id, '/extend-deadline', body);
  assert.equal((await ext(fwdA, { days: 2, reason: 'Preciso de mais tempo' })).status, 403);
  assert.equal((await ext(loja, { days: 2, reason: 'Preciso de mais tempo' })).status, 403);
  assert.equal((await ext(admin, { days: 0, reason: 'Preciso de mais tempo' })).status, 400);
  assert.equal((await ext(admin, { days: 8, reason: 'Preciso de mais tempo' })).status, 400);
  assert.equal((await ext(admin, { days: 2, reason: 'abc' })).status, 400);

  await pool.query('UPDATE payment_commitments SET due_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE process_id = ?', [per.id]);
  assert.deepEqual(await runPaymentChecks(), { dueSoon: 0, overdue: 1 });
  assert.equal((await get(admin, per.id)).paymentOverdue, true);
  const first = (await ext(admin, { days: 3, reason: 'Banco com instabilidade no pagamento' })).body.process;
  assert.equal(first.paymentOverdue, false, 'depois de prorrogar deixa de estar em atraso');
  assert.equal(first.commitment.extensions.length, 1);
  assert.equal(first.commitment.extensionsLeft, 1);
  const days = (new Date(first.commitment.dueAt) - Date.now()) / 86400000;
  assert.ok(days > 2.9 && days < 3.1, `prazo ~3 dias a contar de agora (obtido ${days})`);
  const [[flags]] = await pool.query('SELECT reminder_sent_at, overdue_notified_at FROM payment_commitments WHERE process_id = ?', [per.id]);
  assert.deepEqual([flags.reminder_sent_at, flags.overdue_notified_at], [null, null], 'alertas voltam a disparar');
  assert.ok((await inbox(fwdA)).includes('DEADLINE_EXTENDED'));

  await pool.query('UPDATE payment_commitments SET due_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE process_id = ?', [per.id]);
  assert.deepEqual(await runPaymentChecks(), { dueSoon: 0, overdue: 1 }, 'novo alerta após a prorrogação');
  assert.equal((await ext(admin, { days: 7, reason: 'Última prorrogação autorizada' })).status, 200);
  assert.equal((await code(admin, per.id, '/extend-deadline', { days: 1, reason: 'Mais uma prorrogação' })), 'EXTENSION_LIMIT');

  // =========== revogação de autorização ===========
  const p6 = await submit(fwdA);
  assert.equal(await code(admin, p6.id, '/extend-deadline', { days: 2, reason: 'Sem compromisso de pagamento' }), 'NO_DEADLINE');
  await pool.query('UPDATE payment_commitments SET due_at = NULL WHERE process_id = ?', [per.id]); // o compromisso em atraso bloquearia este
  await approve(p6.id);
  const auth6 = await ok(admin, p6.id, '/authorization', release, 201);
  await ok(fwdA, p6.id, '/commitment', { password: 'Senha1234', accept: true }, 201);
  const oldCode = auth6.authorization.code;
  assert.equal((await post(loja, p6.id, '/authorization/revoke', { reason: 'Documento errado' })).status, 403);
  assert.equal((await post(fat, p6.id, '/authorization/revoke', { reason: 'Documento errado' })).status, 403);
  assert.equal((await post(soyo, p6.id, '/authorization/revoke', { reason: 'Documento errado' })).status, 404, 'outra entidade');
  const revoked = await ok(admin, p6.id, '/authorization/revoke', { reason: 'Documento do cliente com erro' });
  assert.equal(revoked.status, 'EM_PROCESSAMENTO_INTERNO', 'a revogação não muda o estado');
  assert.equal(revoked.authorization, null);
  assert.equal(revoked.commitment.dueAt, null, 'sem saída antecipada não há prazo');
  assert.ok((await inbox(fwdA)).includes('AUTHORIZATION_REVOKED'));
  const revokedCheck = (await api('GET', `/verify/authorization/${oldCode}`)).body;
  assert.deepEqual([revokedCheck.valid, revokedCheck.state, revokedCheck.reference], [false, 'REVOGADA', p6.reference]);
  assert.equal(await code(admin, p6.id, '/authorization/revoke', { reason: 'Revogar outra vez' }), 'NO_AUTHORIZATION');

  const reissued = await ok(chefe, p6.id, '/authorization', release, 201);
  assert.notEqual(reissued.authorization.code, oldCode, 'nova autorização, novo código');
  assert.equal((await proforma(p6.id)).body.error.code, 'AUTHORIZATION_AWAITING_ACCEPTANCE', 'proforma espera o aceite');
  await ok(fwdA, p6.id, '/commitment', { password: 'Senha1234', accept: true }, 201);
  assert.equal((await api('GET', `/verify/authorization/${reissued.authorization.code}`)).body.valid, true);
  assert.equal((await api('GET', `/verify/authorization/${oldCode}`)).body.revoked, true);
  const [[active]] = await pool.query('SELECT COUNT(*) AS n FROM authorizations WHERE process_id = ? AND revoked_at IS NULL', [p6.id]);
  assert.equal(active.n, 1, 'uma só autorização ativa');

  assert.equal((await proforma(p6.id, { dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) })).status, 200);
  await proof(p6.id);
  await ok(fat, p6.id, '/confirm-payment', {});
  assert.equal(await code(admin, p6.id, '/authorization/revoke', { reason: 'O pagamento já foi confirmado' }), 'INVALID_TRANSITION');

  // =========== reabrir processos rejeitados ===========
  const p7 = await submit(fwdA);
  assert.equal(await code(admin, p7.id, '/reopen', { reason: 'Ainda não foi rejeitado' }), 'INVALID_TRANSITION');
  await ok(loja, p7.id, '/transition', { status: 'EM_ANALISE' });
  await ok(loja, p7.id, '/transition', { status: 'REJEITADO', notes: 'Documentação ilegível' });
  assert.equal((await post(loja, p7.id, '/reopen', { reason: 'Documentos corrigidos' })).status, 403);
  const reopened = await ok(admin, p7.id, '/reopen', { reason: 'Documentos corrigidos pelo transitário' });
  assert.equal(reopened.status, 'EM_ANALISE');
  assert.equal(reopened.archivedAt, null, 'reabrir tira do arquivo');
  assert.ok((await inbox(fwdA)).includes('PROCESS_REOPENED'));

  // cancelamento administrativo enquanto os documentos estão em análise
  const p8 = await submit(fwdA);
  await ok(loja, p8.id, '/transition', { status: 'EM_ANALISE' });
  const staffCancelled = await ok(admin, p8.id, '/cancel', { reason: 'Importação suspensa pela Sogester' });
  assert.equal(staffCancelled.status, 'CANCELADO');
  assert.ok((await inbox(fwdA)).includes('PROCESS_CANCELLED'));
  assert.equal((await post(loja, p8.id, '/cancel', { reason: 'Loja não pode cancelar' })).status, 403);
});
