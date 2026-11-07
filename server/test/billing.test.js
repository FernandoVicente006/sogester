import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'sogester_test';
process.env.SETUP_TOKEN = 'test-setup-token';

const { config } = await import('../src/config.js');
const { migrate } = await import('../src/db/migrate.js');
const { seed } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

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

function form(data, files) {
  const fd = new FormData();
  if (data) fd.append('data', JSON.stringify(data));
  for (const f of files) fd.append(f, PDF(), `${f}.pdf`);
  return fd;
}

const cargo = (extra = {}) => ({
  entityId: 1,
  client: { type: 'SINGULAR', name: 'João Silva', documentNumber: '004567890LA041' },
  cargoPriority: 'NAO_PRIORITARIO',
  volumeType: 'CARGA_GERAL',
  cargoCategory: 'Mercadoria fracionada',
  description: 'Caixas de roupa',
  quantity: 20,
  weightKg: 800,
  ...extra,
});

before(async () => {
  const { database, ...conn } = config.db;
  const root = await mysql.createConnection(conn);
  await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await root.end();
  await migrate({ log: () => {} });
  await seed({ log: () => {} });
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

test('fluxo normal, proforma, comprovativo, fatura recibo e saída antecipada', async () => {
  // --- preparação
  await api('POST', '/setup/entity-admin', {
    body: { entityCode: 'CABINDA', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' },
    headers: { 'x-setup-token': 'test-setup-token' },
  });
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
      body: {
        name: `Transitário ${n}`,
        nif: `54170001${n}${n}`,
        email: `t${n}@t.ao`,
        location: 'Cabinda',
        user: { name: `U${n}`, email: `u${n}@t.ao`, password: 'Senha1234' },
      },
    });
    await api('PUT', `/forwarders/${r.body.forwarder.id}/entities/1`, { token: admin, body: { status: 'APROVADO' } });
    return login(`u${n}@t.ao`, 'Senha1234');
  };
  const fwdA = await mkForwarder(1);
  const fwdB = await mkForwarder(2);

  const submit = async (token, extra) => {
    const r = await api('POST', '/processes', { token, form: form(cargo(extra), ['ep17', 'bilhete']) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.process;
  };
  const step = (token, path, expected, opts = {}) =>
    api('POST', `/processes/${opts.id}${path}`, { token, ...opts.req }).then((r) => {
      assert.equal(r.status, expected, `${path}: ${JSON.stringify(r.body)}`);
      return r.body;
    });
  const analyse = (id) => step(loja, '/transition', 200, { id, req: { body: { status: 'EM_ANALISE' } } });

  // =========== fluxo normal (carga não perecível) ===========
  const p = await submit(fwdA);
  await analyse(p.id);

  assert.equal((await api('GET', `/processes/${p.id}/commitment-terms`, { token: fwdA })).status, 200);
  await step(fwdA, '/commitment', 409, { id: p.id, req: { body: { password: 'Senha1234', accept: true } } }); // não perecível
  // proforma: só depois de os documentos estarem conformes, carregada pela Loja; só o ficheiro é obrigatório
  const proformaForm = () =>
    form({ number: 'PF-2026/001', amount: 150000.5, paymentEntity: '11111', paymentReference: '987654321' }, ['proforma']);
  await step(loja, '/proforma', 409, { id: p.id, req: { form: proformaForm() } }); // ainda em análise
  await step(fat, '/transition', 403, { id: p.id, req: { body: { status: 'EM_PROCESSAMENTO_INTERNO' } } });
  const approved = (await step(loja, '/transition', 200, { id: p.id, req: { body: { status: 'EM_PROCESSAMENTO_INTERNO' } } })).process;
  assert.equal(approved.status, 'EM_PROCESSAMENTO_INTERNO');
  assert.equal(approved.authorization, null, 'o fluxo normal não usa autorização');

  await step(fat, '/proforma', 403, { id: p.id, req: { form: proformaForm() } });
  await step(fwdA, '/proforma', 403, { id: p.id, req: { form: proformaForm() } });
  await step(loja, '/proforma', 400, { id: p.id, req: { form: form({ number: 'x' }, []) } }); // sem ficheiro
  const withProforma = (await step(loja, '/proforma', 200, { id: p.id, req: { form: proformaForm() } })).process;
  assert.equal(withProforma.status, 'PAGAMENTO_PENDENTE');
  assert.equal(withProforma.invoice.amount, 150000.5);
  assert.equal(withProforma.invoice.paymentReference, '987654321');
  assert.ok(withProforma.documents.some((d) => d.kind === 'PROFORMA'));
  await step(loja, '/proforma', 409, { id: p.id, req: { form: proformaForm() } });

  // o transitário não pode forjar documentos de faturação pelo endpoint genérico
  const forged = new FormData();
  forged.append('kind', 'FATURA_RECIBO');
  forged.append('file', PDF(), 'x.pdf');
  assert.equal((await api('POST', `/processes/${p.id}/documents`, { token: fwdA, form: forged })).status, 400);

  // comprovativo: só o transitário dono
  await step(fwdB, '/payment-proof', 404, { id: p.id, req: { form: form(null, ['proof']) } });
  await step(fat, '/payment-proof', 403, { id: p.id, req: { form: form(null, ['proof']) } });
  await step(fat, '/confirm-payment', 409, { id: p.id, req: { body: {} } }); // sem comprovativo
  const proofed = (await step(fwdA, '/payment-proof', 200, { id: p.id, req: { form: form(null, ['proof']) } })).process;
  assert.equal(proofed.status, 'PAGAMENTO_SUBMETIDO');

  await step(fat, '/reject-payment', 400, { id: p.id, req: { body: {} } });
  const rejected = (await step(fat, '/reject-payment', 200, { id: p.id, req: { body: { notes: 'Valor não confere' } } })).process;
  assert.equal(rejected.status, 'PAGAMENTO_PENDENTE');
  assert.equal(rejected.statusNotes, 'Valor não confere');
  await step(fwdA, '/payment-proof', 200, { id: p.id, req: { form: form(null, ['proof']) } });

  await step(fwdA, '/confirm-payment', 403, { id: p.id, req: { body: {} } });
  const confirmed = (await step(fat, '/confirm-payment', 200, { id: p.id, req: { body: {} } })).process;
  assert.equal(confirmed.status, 'PAGAMENTO_CONFIRMADO');
  assert.ok(confirmed.invoice.paymentConfirmedAt);

  await step(loja, '/receipt', 403, { id: p.id, req: { form: form({ number: 'FR-1' }, ['receipt']) } });
  const done = (await step(fat, '/receipt', 200, { id: p.id, req: { form: form({ number: 'FR 2026/001' }, ['receipt']) } })).process;
  assert.equal(done.status, 'CONCLUIDO');
  assert.equal(done.invoice.receiptNumber, 'FR 2026/001');
  assert.deepEqual(done.history.map((h) => h.toStatus), [
    'SUBMETIDO', 'EM_ANALISE', 'EM_PROCESSAMENTO_INTERNO', 'PAGAMENTO_PENDENTE', 'PAGAMENTO_SUBMETIDO',
    'PAGAMENTO_PENDENTE', 'PAGAMENTO_SUBMETIDO', 'PAGAMENTO_CONFIRMADO', 'CONCLUIDO',
  ]);
  const receipt = done.documents.find((d) => d.kind === 'FATURA_RECIBO');
  const dl = await fetch(`${base}/api/v1/processes/${p.id}/documents/${receipt.id}`, { headers: { authorization: `Bearer ${fwdA}` } });
  assert.equal(dl.status, 200);
  const dlOther = await fetch(`${base}/api/v1/processes/${p.id}/documents/${receipt.id}`, { headers: { authorization: `Bearer ${fwdB}` } });
  assert.equal(dlOther.status, 404);

  // =========== só o ficheiro é obrigatório ===========
  const bare = await submit(fwdA);
  await analyse(bare.id);
  await step(loja, '/transition', 200, { id: bare.id, req: { body: { status: 'EM_PROCESSAMENTO_INTERNO' } } });
  const noData = (await step(loja, '/proforma', 200, { id: bare.id, req: { form: form(null, ['proforma']) } })).process;
  assert.equal(noData.status, 'PAGAMENTO_PENDENTE');
  assert.deepEqual([noData.invoice.proformaNumber, noData.invoice.amount, noData.invoice.paymentReference], [null, null, null]);
  await step(fwdA, '/payment-proof', 200, { id: bare.id, req: { form: form(null, ['proof']) } });
  await step(fat, '/confirm-payment', 200, { id: bare.id, req: { body: {} } });
  await step(fat, '/receipt', 400, { id: bare.id, req: { form: form(null, []) } }); // sem ficheiro
  const noNumber = (await step(fat, '/receipt', 200, { id: bare.id, req: { form: form(null, ['receipt']) } })).process;
  assert.equal(noNumber.status, 'CONCLUIDO');
  assert.equal(noNumber.invoice.receiptNumber, null);

  // =========== saída antecipada: exceção paralela ao fluxo ===========
  const per = await submit(fwdA, { cargoPriority: 'PERECIVEL', cargoCategory: 'Mercadoria frigorífica ou congelada', description: 'Peixe' });
  await analyse(per.id);
  await step(chefe, '/authorization', 409, { id: per.id, req: { body: {} } }); // falta compromisso
  assert.equal((await api('POST', `/processes/${per.id}/authorization`, { token: chefe, body: {} })).body.error.code, 'COMMITMENT_REQUIRED');

  const terms = (await api('GET', `/processes/${per.id}/commitment-terms`, { token: fwdA })).body;
  assert.match(terms.text, new RegExp(per.reference));
  await step(fwdA, '/commitment', 400, { id: per.id, req: { body: { password: 'errada', accept: true } } });
  await step(fwdA, '/commitment', 400, { id: per.id, req: { body: { password: 'Senha1234', accept: false } } });
  await step(fwdB, '/commitment', 404, { id: per.id, req: { body: { password: 'Senha1234', accept: true } } });
  await step(loja, '/commitment', 403, { id: per.id, req: { body: { password: 'Senha1234', accept: true } } });
  const signed = (await step(fwdA, '/commitment', 201, { id: per.id, req: { body: { password: 'Senha1234', accept: true } } })).process;
  assert.equal(signed.hasCommitment, true);
  assert.equal(signed.commitment.dueAt, null);
  await step(fwdA, '/commitment', 409, { id: per.id, req: { body: { password: 'Senha1234', accept: true } } });

  for (const t of [loja, fat, fwdA]) await step(t, '/authorization', 403, { id: per.id, req: { body: {} } });
  const early = (await step(chefe, '/authorization', 201, { id: per.id, req: { body: {} } })).process;
  assert.equal(early.status, 'EM_ANALISE', 'não muda o estado do processo');
  assert.equal(early.authorization.type, 'SAIDA_ANTECIPADA');
  assert.match(early.authorization.code, /^AUT-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal((await api('POST', `/processes/${per.id}/authorization`, { token: admin, body: {} })).body.error.code, 'ALREADY_AUTHORIZED');
  assert.equal((await api('POST', `/processes/${per.id}/transition`, { token: loja, body: { status: 'REJEITADO', notes: 'Falta documento' } })).body.error.code, 'EARLY_RELEASE_BINDING');
  assert.ok(early.commitment.dueAt, 'prazo de pagamento definido na autorização');
  assert.equal(early.paymentOverdue, false);

  // verificação pública do código
  const code = early.authorization.code;
  const ok = (await api('GET', `/verify/authorization/${code}`)).body;
  assert.equal(ok.valid, true);
  assert.equal(ok.reference, per.reference);
  assert.equal(ok.paymentSettled, false);
  assert.equal(ok.client, undefined, 'não expõe dados do cliente');
  const tampered = `${code.slice(0, -1)}${code.endsWith('0') ? '1' : '0'}`;
  assert.equal((await api('GET', `/verify/authorization/${tampered}`)).body.valid, false);
  assert.equal((await api('GET', '/verify/authorization/lixo')).status, 400);

  // =========== salvaguarda: compromissos em atraso bloqueiam novos ===========
  const per2 = await submit(fwdA, { cargoPriority: 'PERECIVEL', cargoCategory: 'Mercadoria frigorífica ou congelada', description: 'Carne' });
  await pool.query('UPDATE payment_commitments SET due_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE process_id = ?', [per.id]);
  const list = (await api('GET', '/processes', { token: fat })).body.processes;
  assert.equal(list.find((x) => x.id === per.id).paymentOverdue, true);
  const blocked = await api('POST', `/processes/${per2.id}/commitment`, { token: fwdA, body: { password: 'Senha1234', accept: true } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'OVERDUE_COMMITMENTS');

  // liquidar o primeiro remove o bloqueio
  await step(loja, '/transition', 200, { id: per.id, req: { body: { status: 'EM_PROCESSAMENTO_INTERNO' } } });
  await step(loja, '/proforma', 200, { id: per.id, req: { form: proformaForm() } });
  await step(fwdA, '/payment-proof', 200, { id: per.id, req: { form: form(null, ['proof']) } });
  await step(fat, '/confirm-payment', 200, { id: per.id, req: { body: {} } });
  const settled = (await api('GET', `/processes/${per.id}`, { token: fwdA })).body.process;
  assert.equal(settled.paymentOverdue, false);
  assert.equal((await api('GET', `/verify/authorization/${code}`)).body.paymentSettled, true);
  await step(fwdA, '/commitment', 201, { id: per2.id, req: { body: { password: 'Senha1234', accept: true } } });
});
