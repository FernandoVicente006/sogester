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

let server;
let base;

async function raw(method, path, { token, body, form, headers } = {}) {
  return fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
}
async function api(method, path, opts) {
  const res = await raw(method, path, opts);
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const login = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).body.token;
const PDF = () => new Blob(['%PDF-1.4 teste'], { type: 'application/pdf' });

function submission(extra = {}, clientName = 'João Silva') {
  const fd = new FormData();
  fd.append(
    'data',
    JSON.stringify({
      entityId: 1,
      client: { type: 'SINGULAR', name: clientName, documentNumber: '004567890LA041' },
      cargoPriority: 'NAO_PRIORITARIO',
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
  fd.append('bilhete', PDF(), 'bilhete.pdf');
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

test('relatórios: processos, receita e atrasos (filtros, permissões e CSV)', async () => {
  const superToken = await bootstrapMaster(base);
  await createEntityAdmin(base, superToken, { entityCode: 'CABINDA', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' });
  const admin = await login('dir@cabinda.ao', 'Senha1234');
  for (const [name, role] of [['Loja', 'LOJA'], ['Fat', 'FINANCAS'], ['Cad', 'CADASTRO']]) {
    await api('POST', '/users', { token: admin, body: { name, email: `${role.toLowerCase()}@cabinda.ao`, password: 'Senha1234', role } });
  }
  const loja = await login('loja@cabinda.ao', 'Senha1234');
  const fat = await login('financas@cabinda.ao', 'Senha1234');
  const cadastro = await login('cadastro@cabinda.ao', 'Senha1234');

  const forwarders = {};
  const mkForwarder = async (n) => {
    const r = await api('POST', '/forwarders', {
      token: admin,
      body: { name: `Transitário ${n}`, nif: `54170001${n}${n}`, email: `t${n}@t.ao`, location: 'Cabinda', user: { name: `U${n}`, email: `u${n}@t.ao`, password: 'Senha1234' } },
    });
    await api('PUT', `/forwarders/${r.body.forwarder.id}/entities/1`, { token: admin, body: { status: 'APROVADO' } });
    forwarders[n] = r.body.forwarder.id;
    return login(`u${n}@t.ao`, 'Senha1234');
  };
  const fwdA = await mkForwarder(1);
  const fwdB = await mkForwarder(2);

  await api('PATCH', '/entities/2', { token: superToken, body: { active: true } });
  await createEntityAdmin(base, superToken, { entityCode: 'SOYO', name: 'Diretor Soyo', email: 'dir@soyo.ao', password: 'Senha1234' });
  const soyo = await login('dir@soyo.ao', 'Senha1234');

  const submit = async (token, extra, name) => (await api('POST', '/processes', { token, form: submission(extra, name) })).body.process;
  const post = async (token, id, path, opts = {}) => {
    const r = await api('POST', `/processes/${id}${path}`, { token, ...opts });
    assert.ok(r.status < 300, `${path}: ${r.status} ${JSON.stringify(r.body)}`);
  };
  const approve = async (id) => {
    await post(loja, id, '/transition', { body: { status: 'EM_ANALISE' } });
    await post(loja, id, '/transition', { body: { status: 'EM_PROCESSAMENTO_INTERNO' } });
  };
  const proforma = (id, amount) =>
    post(loja, id, '/proforma', { form: file('proforma', { number: `PF-${id}`, amount, paymentEntity: '11111', paymentReference: `REF${id}` }) });
  const pay = async (id, token) => {
    await post(token, id, '/payment-proof', { form: file('proof') });
    await post(fat, id, '/confirm-payment', { body: {} });
  };
  const setHistory = (id, status, at) => pool.query('UPDATE process_status_history SET created_at = ? WHERE process_id = ? AND to_status = ?', [at, id, status]);

  // --- dados: p1 (A, cobrado), p2 (A, perecível em dívida), p3 (B, cobrado), p4 (B, cancelado), p5 (A, parado), p6 (B, cancelado com proforma)
  const p1 = await submit(fwdA);
  await approve(p1.id);
  await proforma(p1.id, 1000.5);
  await pay(p1.id, fwdA);
  await post(fat, p1.id, '/receipt', { form: file('receipt', { number: 'FR-1' }) });

  const p2 = await submit(fwdA, { cargoPriority: 'PERECIVEL', cargoCategory: 'Mercadoria frigorífica ou congelada', description: 'Peixe' });
  await post(admin, p2.id, '/transition', { body: { status: 'EM_ANALISE' } });
  await post(admin, p2.id, '/authorization', { body: { reason: 'Avaria do pórtico da Sogester impede a saída normal', validDays: 2 } });
  await post(fwdA, p2.id, '/commitment', { body: { password: 'Senha1234', accept: true } });
  await post(loja, p2.id, '/transition', { body: { status: 'EM_PROCESSAMENTO_INTERNO' } });
  await post(loja, p2.id, '/proforma', { form: file('proforma', { number: `PF-${p2.id}`, amount: 2000, paymentEntity: '11111', paymentReference: `REF${p2.id}`, dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }) });

  const p3 = await submit(fwdB);
  await approve(p3.id);
  await proforma(p3.id, 500);
  await pay(p3.id, fwdB);
  await post(fat, p3.id, '/receipt', { form: file('receipt', { number: 'FR-3' }) });

  const p4 = await submit(fwdB);
  await post(fwdB, p4.id, '/cancellation', { body: { reason: 'Cliente desistiu do negócio' } });

  const p5 = await submit(fwdA, { urgencyRequested: true, urgencyReason: 'Navio parte hoje' }, '=SUM(1+1)');

  const p6 = await submit(fwdB);
  await approve(p6.id);
  await proforma(p6.id, 999);
  // Já não se cancela depois da aprovação documental: simula um cancelamento antigo.
  await pool.query("UPDATE processes SET status = 'CANCELADO' WHERE id = ?", [p6.id]);

  // p7: proforma sem valor (opcional) fica fora dos totais
  const p7 = await submit(fwdB);
  await approve(p7.id);
  await post(loja, p7.id, '/proforma', { form: file('proforma') });
  await pool.query('UPDATE processes SET submitted_at = ? WHERE id = ?', ['2025-01-01 00:00:00', p7.id]);
  await pool.query('UPDATE invoices SET proforma_issued_at = ? WHERE process_id = ?', ['2026-09-20 00:00:00', p7.id]);

  // --- datas fixas para tornar os relatórios determinísticos
  const day = (d, h = 0) => `${d} ${String(h).padStart(2, '0')}:00:00`;
  await pool.query('UPDATE processes SET submitted_at = ? WHERE id = ?', [day('2026-08-10'), p1.id]);
  await pool.query('UPDATE processes SET submitted_at = ? WHERE id = ?', [day('2026-09-03'), p2.id]);
  await pool.query('UPDATE processes SET submitted_at = ? WHERE id = ?', [day('2026-09-10'), p3.id]);
  await pool.query('UPDATE processes SET submitted_at = ? WHERE id = ?', [day('2026-09-12'), p4.id]);
  await pool.query('UPDATE processes SET submitted_at = ? WHERE id = ?', [day('2026-09-25'), p5.id]);
  await pool.query('UPDATE processes SET submitted_at = ? WHERE id = ?', [day('2026-09-14'), p6.id]);
  await setHistory(p1.id, 'EM_PROCESSAMENTO_INTERNO', day('2026-08-10', 6));
  await setHistory(p1.id, 'CONCLUIDO', day('2026-08-14'));
  await setHistory(p2.id, 'EM_PROCESSAMENTO_INTERNO', day('2026-09-04'));
  await setHistory(p3.id, 'EM_PROCESSAMENTO_INTERNO', day('2026-09-10', 12));
  await setHistory(p3.id, 'CONCLUIDO', day('2026-09-12'));
  await setHistory(p5.id, 'SUBMETIDO', day('2026-09-25'));
  await setHistory(p6.id, 'EM_PROCESSAMENTO_INTERNO', day('2026-09-14', 6));
  await pool.query('UPDATE invoices SET proforma_issued_at = ?, payment_confirmed_at = ? WHERE process_id = ?', [day('2026-08-12'), day('2026-09-02'), p1.id]);
  await pool.query('UPDATE invoices SET proforma_issued_at = ?, payment_confirmed_at = NULL WHERE process_id = ?', [day('2026-09-05'), p2.id]);
  await pool.query('UPDATE invoices SET proforma_issued_at = ?, payment_confirmed_at = ? WHERE process_id = ?', [day('2026-09-10'), day('2026-09-15'), p3.id]);
  await pool.query('UPDATE invoices SET proforma_issued_at = ? WHERE process_id = ?', [day('2026-09-06'), p6.id]);
  await pool.query('UPDATE payment_commitments SET due_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE process_id = ?', [p2.id]);

  const period = 'from=2026-08-01&to=2026-09-30';
  const report = async (token, name, query = '') => (await api('GET', `/reports/${name}?${query}`, { token }));

  // =========== processos ===========
  const first = await report(loja, 'processes', period);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const proc = first.body.report;
  assert.equal(proc.summary.total, 6);
  assert.deepEqual(proc.summary.byStatus, { CONCLUIDO: 2, CANCELADO: 2, PAGAMENTO_PENDENTE: 1, SUBMETIDO: 1 });
  assert.equal(proc.summary.completed, 2);
  assert.equal(proc.summary.cancelled, 2);
  assert.equal(proc.summary.active, 2);
  assert.equal(proc.summary.urgent, 1);
  assert.equal(proc.summary.avgHoursToApproval, 12); // p1 6 h, p2 24 h, p3 12 h, p6 6 h
  assert.equal(proc.summary.avgHoursToComplete, 72);
  assert.equal(proc.summary.byPriority.PERECIVEL, 1);
  assert.equal(proc.summary.byForwarder[0].total, 3);
  assert.equal(proc.rows[0].reference, p5.reference, 'mais recentes primeiro');
  const row1 = proc.rows.find((r) => r.id === p1.id);
  assert.equal(row1.hoursToApproval, 6);
  assert.equal(row1.amount, 1000.5);

  const filtered = async (query) => (await report(loja, 'processes', `${period}&${query}`)).body.report.rows.map((r) => r.id).sort();
  assert.deepEqual(await filtered('status=CONCLUIDO'), [p1.id, p3.id].sort());
  assert.deepEqual(await filtered('priority=PERECIVEL'), [p2.id]);
  assert.deepEqual(await filtered(`forwarderId=${forwarders[2]}`), [p3.id, p4.id, p6.id].sort());
  assert.deepEqual((await report(loja, 'processes', 'from=2026-09-01&to=2026-09-30')).body.report.rows.length, 5, 'período exclui p1');
  assert.equal((await report(loja, 'processes', 'from=2026-01-01&to=2026-01-31')).body.report.summary.total, 0);

  assert.equal((await report(cadastro, 'processes', period)).status, 200);
  assert.equal((await report(fwdA, 'processes', period)).status, 403);
  assert.equal((await report(soyo, 'processes', period)).body.report.summary.total, 0, 'outro terminal não vê Cabinda');
  assert.equal((await report(superToken, 'processes', `${period}&entityId=1`)).body.report.summary.total, 6);
  assert.equal((await report(admin, 'processes', 'from=2026-13-45')).status, 400);
  assert.equal((await report(admin, 'processes', 'from=2026-09-30&to=2026-09-01')).body.error.code, 'INVALID_PERIOD');
  assert.equal((await report(admin, 'nada', period)).status, 400);
  assert.equal((await api('GET', '/reports/processes')).status, 401);

  // CSV
  const csvRes = await raw('GET', `/reports/processes?${period}&format=csv`, { token: loja });
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get('content-type'), /text\/csv/);
  assert.match(csvRes.headers.get('content-disposition'), /attachment; filename="sogester-processes-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = new Uint8Array(await csvRes.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para o Excel');
  const csv = new TextDecoder('utf-8').decode(bytes);
  assert.ok(csv.startsWith('Referência;Terminal;Transitário;'), 'cabeçalho em português');
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 7);
  assert.ok(csv.includes("'=SUM(1+1)"), 'proteção contra injeção de fórmulas');
  assert.ok(csv.includes(';1000,5;'), 'decimais com vírgula');
  assert.ok(csv.includes('Perecível') && csv.includes('Concluído'));
  const [[logged]] = await pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'REPORT_EXPORTED'");
  assert.equal(logged.n, 1, 'exportações ficam auditadas');

  // =========== receita ===========
  const rev = (await report(fat, 'revenue', period)).body.report;
  assert.deepEqual(rev.totals, [{ currency: 'AOA', invoiced: 3500.5, collected: 1500.5, outstanding: 2000 }]);
  assert.deepEqual(rev.series, [
    { month: '2026-08', currency: 'AOA', invoiced: 1000.5, collected: 0 },
    { month: '2026-09', currency: 'AOA', invoiced: 2500, collected: 1500.5 },
  ]);
  assert.deepEqual(rev.topForwarders.map((f) => [f.forwarder, f.collected]), [['Transitário 1', 1000.5], ['Transitário 2', 500]]);
  assert.ok(!rev.rows.some((r) => r.id === p6.id), 'processos cancelados não contam');
  assert.equal(rev.withoutAmount, 1, 'proforma sem valor é assinalada');
  assert.equal(rev.rows.find((r) => r.id === p7.id).amount, null);
  const sept = (await report(fat, 'revenue', 'from=2026-09-01&to=2026-09-30')).body.report;
  assert.deepEqual(sept.totals, [{ currency: 'AOA', invoiced: 2500, collected: 1500.5, outstanding: 2000 }]);
  assert.equal(sept.rows.length, 4, 'inclui a proforma de agosto paga em setembro e a que não tem valor');
  assert.equal((await report(admin, 'revenue', period)).status, 200);
  for (const t of [loja, cadastro, fwdA]) assert.equal((await report(t, 'revenue', period)).status, 403);
  assert.equal((await report(soyo, 'revenue', period)).body.report.totals.length, 0);
  const revCsv = await (await raw('GET', `/reports/revenue?${period}&format=csv`, { token: fat })).text();
  assert.ok(revCsv.includes('N.º da proforma') && revCsv.includes('FR-1'));

  // =========== atrasos ===========
  const late = (await report(fat, 'overdue')).body.report;
  assert.equal(late.payments.count, 1);
  assert.equal(late.payments.rows[0].reference, p2.reference);
  assert.ok(late.payments.rows[0].hoursOverdue >= 47);
  assert.deepEqual(late.payments.owed, [{ currency: 'AOA', amount: 2000 }]);
  assert.deepEqual(late.stalled.rows.map((r) => r.id), [p5.id], 'só p5 está parado há mais de 24 h');
  assert.equal(late.stalled.rows[0].waitingOn, 'Sogester (Loja)');
  const all = (await report(fat, 'overdue', 'minHours=0')).body.report;
  assert.deepEqual(all.stalled.byWaitingOn, { 'Sogester (Loja)': 1, 'Transitário': 2 });
  assert.equal((await report(loja, 'overdue')).status, 403);
  assert.equal((await report(soyo, 'overdue')).body.report.payments.count, 0);
  const stalledCsv = await (await raw('GET', '/reports/overdue?kind=stalled&format=csv', { token: fat })).text();
  assert.ok(stalledCsv.includes('A aguardar') && stalledCsv.includes(p5.reference));
  const payCsv = await (await raw('GET', '/reports/overdue?kind=payments&format=csv', { token: admin })).text();
  assert.ok(payCsv.includes('Valor em dívida') && payCsv.includes(p2.reference));

  // pagar a dívida tira-a do relatório
  await pay(p2.id, fwdA);
  assert.equal((await report(fat, 'overdue')).body.report.payments.count, 0);
});
