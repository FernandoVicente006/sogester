// Fluxo completo nos três terminais (Cabinda, Soyo e Luanda) com o mesmo transitário,
// isolamento entre terminais e o relatório comparativo do administrador geral.
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

async function api(method, path, { token, body, form } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // CSV
  }
  return { status: res.status, body: parsed };
}
const login = async (email, password = 'Senha1234') => (await api('POST', '/auth/login', { body: { email, password } })).body.token;
const PDF = () => new Blob(['%PDF-1.4 teste'], { type: 'application/pdf' });
function form(data, files) {
  const fd = new FormData();
  if (data) fd.append('data', JSON.stringify(data));
  for (const f of files) fd.append(f, PDF(), `${f}.pdf`);
  return fd;
}
const cargo = (entityId, extra = {}) => ({
  entityId,
  operation: 'DESEMBARQUE',
  client: { type: 'EMPRESA', name: 'Cliente Lda', documentNumber: '5417000001' },
  cargoPriority: 'NAO_PRIORITARIO',
  volumeType: 'CARGA_GERAL',
  cargoCategory: 'Mercadoria fracionada',
  blNumber: `BL-${entityId}`,
  duNumber: `2026R${entityId}`,
  vesselName: 'Tchiowa',
  voyageNumber: '7',
  dischargeType: 'INDIRECTA',
  weightKg: 500,
  goods: [{ description: 'Caixas', unit: 'Caixa', quantity: 10 }],
  ...extra,
});

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

test('fluxo completo nos três terminais, isolamento e relatório do administrador geral', async () => {
  const master = await bootstrapMaster(base);
  const { entities } = (await api('GET', '/entities', { token: master })).body;
  const byCode = Object.fromEntries(entities.map((e) => [e.code, e]));
  // Soyo e Luanda começam inativos: o administrador geral ativa-os
  for (const e of entities.filter((x) => !x.active)) {
    assert.equal((await api('PATCH', `/entities/${e.id}`, { token: master, body: { active: true } })).status, 200);
  }

  // --- equipa de cada terminal
  const T = {};
  for (const code of ['CABINDA', 'SOYO', 'LUANDA']) {
    const k = code.toLowerCase();
    await createEntityAdmin(base, master, { entityCode: code, name: `Diretor ${code}`, email: `dir@${k}.ao`, password: 'Senha1234' });
    const admin = await login(`dir@${k}.ao`);
    for (const role of ['LOJA', 'FINANCAS']) {
      const r = await api('POST', '/users', { token: admin, body: { name: `${role} ${code}`, email: `${role.toLowerCase()}@${k}.ao`, password: 'Senha1234', role } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    T[code] = { id: byCode[code].id, admin, loja: await login(`loja@${k}.ao`), fin: await login(`financas@${k}.ao`) };
  }

  // --- o mesmo transitário: registado em Cabinda, vinculado pelo NIF em Soyo e Luanda, aprovado por cada terminal
  const created = await api('POST', '/forwarders', {
    token: T.CABINDA.admin,
    body: { name: 'Trans Três', nif: '5417999001', email: 'geral@tres.ao', location: 'Cabinda', user: { name: 'Op', email: 'op@tres.ao', password: 'Senha1234' } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const fwdId = created.body.forwarder.id;
  for (const code of ['SOYO', 'LUANDA']) {
    assert.equal((await api('POST', '/forwarders/link', { token: T[code].admin, body: { nif: '5417999001' } })).status, 201);
  }
  const fwd = await login('op@tres.ao');
  // ainda pendente em Soyo: não pode submeter
  const pendingTry = await api('POST', '/processes', { token: fwd, form: form(cargo(T.SOYO.id), ['ep17', 'reciboEp', 'documentos']) });
  assert.equal(pendingTry.status, 403, JSON.stringify(pendingTry.body));
  for (const code of ['CABINDA', 'SOYO', 'LUANDA']) {
    const r = await api('PUT', `/forwarders/${fwdId}/entities/${T[code].id}`, { token: T[code].admin, body: { status: 'APROVADO' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  // um terminal não aprova o vínculo de outro
  assert.equal((await api('PUT', `/forwarders/${fwdId}/entities/${T.SOYO.id}`, { token: T.CABINDA.admin, body: { status: 'SUSPENSO' } })).status, 403);

  // --- um processo por terminal, do início ao fim
  const AMOUNTS = { CABINDA: 100000, SOYO: 250000, LUANDA: 75000.5 };
  const step = async (token, id, path, req, expected = 200) => {
    const r = await api('POST', `/processes/${id}${path}`, { token, ...req });
    assert.equal(r.status, expected, `${path}: ${JSON.stringify(r.body)}`);
    return r.body.process;
  };
  const done = {};
  for (const code of ['CABINDA', 'SOYO', 'LUANDA']) {
    const t = T[code];
    const r = await api('POST', '/processes', { token: fwd, form: form(cargo(t.id), ['ep17', 'reciboEp', 'documentos']) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const p = r.body.process;
    assert.match(p.reference, new RegExp(`^${code.slice(0, 3)}-\\d{4}-\\d{6}$`));

    // isolamento: a Loja e as Finanças dos outros terminais não veem nem mexem neste processo
    for (const other of Object.keys(T).filter((c) => c !== code)) {
      assert.equal((await api('GET', `/processes/${p.id}`, { token: T[other].loja })).status, 404, `${other} não vê ${code}`);
      await step(T[other].loja, p.id, '/transition', { body: { status: 'EM_ANALISE' } }, 404);
    }

    await step(t.loja, p.id, '/transition', { body: { status: 'EM_ANALISE' } });
    await step(t.loja, p.id, '/transition', { body: { status: 'EM_PROCESSAMENTO_INTERNO' } });
    const pf = await step(t.loja, p.id, '/proforma', { form: form({ number: `PF-${code}`, amount: AMOUNTS[code] }, ['proforma']) });
    assert.equal(pf.status, 'PAGAMENTO_PENDENTE');
    await step(fwd, p.id, '/payment-proof', { form: form(null, ['proof']) });
    const other = code === 'CABINDA' ? 'SOYO' : 'CABINDA';
    await step(T[other].fin, p.id, '/confirm-payment', { body: {} }, 404);
    await step(t.fin, p.id, '/confirm-payment', { body: {} });
    done[code] = await step(t.fin, p.id, '/receipt', { form: form({ number: `FR-${code}` }, ['receipt']) });
    assert.equal(done[code].status, 'CONCLUIDO');
    assert.ok(done[code].archivedAt);
  }

  // um processo de Soyo fica em curso, para os números se distinguirem
  const open = (await api('POST', '/processes', { token: fwd, form: form(cargo(T.SOYO.id), ['ep17', 'reciboEp', 'documentos']) })).body.process;
  await step(T.SOYO.loja, open.id, '/transition', { body: { status: 'EM_ANALISE' } });

  // --- listas: cada terminal só vê o seu; o transitário vê os seus em todos; o administrador geral vê tudo
  const archived = async (token) => (await api('GET', '/processes?archived=1', { token })).body.processes.map((p) => p.reference).sort();
  for (const code of Object.keys(T)) assert.deepEqual(await archived(T[code].loja), [done[code].reference]);
  assert.equal((await archived(fwd)).length, 3);
  assert.equal((await archived(master)).length, 3);
  assert.deepEqual((await api('GET', '/processes', { token: T.SOYO.loja })).body.processes.map((p) => p.id), [open.id]);
  assert.equal((await api('GET', '/processes', { token: T.CABINDA.loja })).body.processes.length, 0);

  // --- relatórios: o terminal só vê os seus números; a comparação é só do administrador geral
  const cabProcesses = (await api('GET', '/reports/processes', { token: T.CABINDA.admin })).body.report;
  assert.equal(cabProcesses.summary.total, 1);
  assert.equal((await api('GET', '/reports/processes?entityId=' + T.SOYO.id, { token: T.CABINDA.admin })).body.report.summary.total, 1, 'ignora o filtro de outro terminal');
  assert.equal((await api('GET', '/reports/terminals', { token: T.CABINDA.admin })).status, 403);
  assert.equal((await api('GET', '/reports/terminals', { token: fwd })).status, 403);

  const report = (await api('GET', '/reports/terminals', { token: master })).body.report;
  const row = (code) => report.rows.find((r) => r.code === code);
  assert.equal(report.rows.length, 3);
  for (const code of Object.keys(T)) {
    assert.equal(row(code).staff, 3, `${code}: diretor, loja e finanças`);
    assert.equal(row(code).forwarders, 1);
    assert.equal(row(code).completed, 1);
    assert.deepEqual(row(code).collected, [{ currency: 'AOA', amount: AMOUNTS[code] }]);
    assert.ok(row(code).avgHoursToComplete !== null);
  }
  assert.equal(row('SOYO').processes, 2);
  assert.equal(row('SOYO').inProgress, 1);
  assert.equal(row('CABINDA').processes, 1);
  assert.equal(report.totals.processes, 4);
  assert.equal(report.totals.completed, 3);
  assert.deepEqual(report.totals.collected, [{ currency: 'AOA', amount: 425000.5 }]);

  const csv = await api('GET', '/reports/terminals?format=csv', { token: master });
  assert.equal(csv.status, 200);
  const lines = csv.body.trim().split(/\r?\n/);
  assert.equal(lines.length, 4, 'cabeçalho e uma linha por terminal');
  assert.match(lines[0], /Terminal.*Processos no período.*Cobrado/);
  assert.ok(lines.some((l) => l.includes('Sogester Soyo') && l.includes('AOA 250000,00')));
});
