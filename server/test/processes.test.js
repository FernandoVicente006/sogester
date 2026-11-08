import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import mysql from 'mysql2/promise';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'sogester_test';
process.env.SETUP_TOKEN = 'test-setup-token';

const { config } = await import('../src/config.js');
const { migrate } = await import('../src/db/migrate.js');
const { bootstrapMaster, createEntityAdmin } = await import('./bootstrap.js');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { documentsDir } = await import('../src/services/processes.js');

let server;
let base;

async function raw(method, path, { token, body, form, headers } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  return res;
}
async function api(method, path, opts) {
  const res = await raw(method, `/api/v1${path}`, opts);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).body.token;

const PDF = () => new Blob(['%PDF-1.4 teste'], { type: 'application/pdf' });
const docCount = () => fs.readdirSync(documentsDir).length;

function form(data, fileFields = ['ep17', 'reciboEp', 'documentos']) {
  const fd = new FormData();
  fd.append('data', JSON.stringify(data));
  for (const f of fileFields) fd.append(f, PDF(), `${f}.pdf`);
  return fd;
}

const cargo = (extra = {}) => ({
  entityId: 1,
  client: { type: 'SINGULAR', name: 'João Silva', documentNumber: '004567890LA041' },
  operation: 'DESEMBARQUE', cargoPriority: 'NAO_PRIORITARIO',
  volumeType: 'CARGA_GERAL',
  cargoCategory: 'Mercadoria fracionada',
  description: 'Caixas de roupa',
  blNumber: 'BL-88626',
  duNumber: '2026R6028',
  vesselName: 'Tchiowa',
  voyageNumber: '12',
  dischargeType: 'INDIRECTA',
  weightKg: 800,
  goods: [{ description: 'Caixas de roupa', unit: 'Caixa', quantity: 20, weightKg: 800 }],
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

test('submissão, fila, estados e documentos de processos', async () => {
  const superToken = await bootstrapMaster(base);
  // --- preparação: admin, loja, dois transitários aprovados e um pendente
  await createEntityAdmin(base, superToken, { entityCode: 'CABINDA', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' });
  const admin = await login('dir@cabinda.ao', 'Senha1234');
  await api('POST', '/users', { token: admin, body: { name: 'Loja', email: 'loja@cabinda.ao', password: 'Senha1234', role: 'LOJA' } });
  await api('POST', '/users', { token: admin, body: { name: 'Fat', email: 'fat@cabinda.ao', password: 'Senha1234', role: 'FINANCAS' } });
  const loja = await login('loja@cabinda.ao', 'Senha1234');

  const mkForwarder = async (n, approve) => {
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
    if (approve) await api('PUT', `/forwarders/${r.body.forwarder.id}/entities/1`, { token: admin, body: { status: 'APROVADO' } });
    return login(`u${n}@t.ao`, 'Senha1234');
  };
  const fwdA = await mkForwarder(1, true);
  const fwdB = await mkForwarder(2, true);
  const fwdPending = await mkForwarder(3, false);

  // --- catálogo
  const meta = await api('GET', '/meta/cargo', { token: fwdA });
  assert.equal(meta.body.volumeTypes.find((v) => v.value === 'CARGA_GRANEL').categories.length, 16);

  // --- submissão válida
  const created = await api('POST', '/processes', { token: fwdA, form: form(cargo()) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const p1 = created.body.process;
  assert.equal(p1.status, 'SUBMETIDO');
  assert.match(p1.reference, /^CAB-\d{4}-\d{6}$/);
  assert.equal(p1.documents.length, 3);
  assert.equal(p1.operation, 'DESEMBARQUE');
  assert.equal(p1.history.length, 1);

  // cliente reconhecido pelo documento
  const again = await api('POST', '/processes', { token: fwdA, form: form(cargo({ urgencyRequested: true, urgencyReason: 'Navio parte hoje' })) });
  assert.equal(again.body.process.client.id, p1.client.id);
  const perishable = await api('POST', '/processes', { token: fwdA, form: form(cargo({ cargoPriority: 'PERECIVEL' })) });
  assert.equal(perishable.status, 201);

  // --- validações (não podem deixar ficheiros órfãos)
  const before = docCount();
  const noEp = await api('POST', '/processes', { token: fwdA, form: form(cargo(), ['reciboEp', 'documentos']) });
  assert.equal(noEp.status, 400);
  assert.ok(noEp.body.error.details.some((d) => d.message.includes('EP17')));
  const noId = await api('POST', '/processes', { token: fwdA, form: form(cargo(), ['ep17']) });
  assert.equal(noId.status, 400);
  const badCat = await api('POST', '/processes', { token: fwdA, form: form(cargo({ cargoCategory: 'Açúcar a granel' })) });
  assert.equal(badCat.status, 400);
  const vehicleMissing = await api('POST', '/processes', {
    token: fwdA,
    form: form(cargo({ volumeType: 'AUTO', cargoCategory: 'Veículos ligeiros em ro-ro', goods: [] })),
  });
  assert.equal(vehicleMissing.status, 400);
  assert.ok(vehicleMissing.body.error.details.some((d) => d.field === 'vehicles'));
  const noDu = await api('POST', '/processes', { token: fwdA, form: form(cargo({ duNumber: undefined })) });
  assert.ok(noDu.body.error.details.some((d) => d.field === 'duNumber'), 'DU obrigatório');
  const noChassis = await api('POST', '/processes', {
    token: fwdA,
    form: form(cargo({ volumeType: 'AUTO', cargoCategory: 'Veículos ligeiros em ro-ro', vehicles: [{ brand: 'Toyota', model: 'Hilux' }] })),
  });
  assert.ok(noChassis.body.error.details.some((d) => d.field === 'vehicles.0.chassis'), 'chassi obrigatório');
  const badLink = await api('POST', '/processes', {
    token: fwdA,
    form: form(cargo({ goods: [{ description: 'Caixas', unit: 'Caixa', quantity: 1, container: 0 }] })),
  });
  assert.ok(badLink.body.error.details.some((d) => d.field === 'goods.0.container'), 'contentor tem de existir');
  const noReason = await api('POST', '/processes', { token: fwdA, form: form(cargo({ urgencyRequested: true })) });
  assert.equal(noReason.status, 400);
  const badJson = await api('POST', '/processes', { token: fwdA, form: new FormData() });
  assert.equal(badJson.status, 400);
  assert.equal(docCount(), before, 'ficheiros de submissões rejeitadas devem ser apagados');

  // carga mista: carro com carga geral dentro, e contentores; empresa estrangeira sem alvará
  const vehicle = await api('POST', '/processes', {
    token: fwdA,
    form: form(
      cargo({
        volumeType: 'AUTO',
        cargoCategory: 'Veículos ligeiros em ro-ro',
        vehicles: [{ chassis: 'JTEBU5JR0K5612345', brand: 'Toyota', model: 'Hilux', fuel: 'Gasóleo' }],
        goods: [{ description: 'Caixas de roupa', unit: 'Caixa', quantity: 12, weightKg: 224, vehicle: 0 }],
      }),
    ),
  });
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.body));
  const mixed = vehicle.body.process;
  assert.equal(mixed.volumeType, 'AUTO');
  assert.equal(mixed.vehicles[0].chassis, 'JTEBU5JR0K5612345');
  assert.deepEqual([mixed.goods[0].vehicleChassis, mixed.goods[0].quantity], ['JTEBU5JR0K5612345', 12], 'mercadoria dentro do carro');
  assert.deepEqual([mixed.blNumber, mixed.duNumber, mixed.dischargeType], ['BL-88626', '2026R6028', 'INDIRECTA']);

  const container = await api('POST', '/processes', {
    token: fwdA,
    form: form(
      cargo({
        volumeType: 'CONTENTOR',
        cargoCategory: undefined,
        regime: '31',
        containers: [
          { number: 'msku1234567', size: '40', type: 'HC', loadStatus: 'CHEIO', seal: 'S1' },
          { number: 'MSKU7654321', size: '20' },
          { number: 'MSKU7654322', size: '20' },
        ],
        goods: [{ description: 'Arroz', unit: 'Saco', quantity: 500, container: 1 }],
      }),
    ),
  });
  assert.equal(container.status, 201, JSON.stringify(container.body));
  assert.deepEqual(container.body.process.containerTotals, { 20: 2, 40: 1, 45: 0 }, 'totais de 20 e 40 pés calculados');
  assert.equal(container.body.process.containers[0].number, 'MSKU1234567');
  assert.equal(container.body.process.goods[0].containerNumber, 'MSKU7654321');
  const repeated = await api('POST', '/processes', {
    token: fwdA,
    form: form(cargo({ volumeType: 'CONTENTOR', cargoCategory: undefined, containers: [{ number: 'MSKU1', size: '20' }, { number: 'MSKU1', size: '40' }] })),
  });
  assert.equal(repeated.status, 400);
  const foreign = await api('POST', '/processes', {
    token: fwdA,
    form: form(cargo({ client: { type: 'EMPRESA', name: 'Foreign Ltd', documentNumber: 'PT500100200', isForeign: true }, operation: 'EMBARQUE' }), ['ep15', 'reciboEp', 'documentos']),
  });
  assert.equal(foreign.status, 201, JSON.stringify(foreign.body));
  const wrongEp = await api('POST', '/processes', {
    token: fwdA,
    form: form(cargo({ client: { type: 'EMPRESA', name: 'Local Lda', documentNumber: '5400000001' } }), ['ep15', 'reciboEp', 'documentos']),
  });
  assert.equal(wrongEp.status, 400, 'desembarque não aceita o EP15');

  // --- permissões de submissão
  assert.equal((await api('POST', '/processes', { token: fwdPending, form: form(cargo()) })).status, 403);
  assert.equal((await api('POST', '/processes', { token: loja, form: form(cargo()) })).status, 403);
  assert.equal((await api('POST', '/processes', { form: form(cargo()) })).status, 401);

  // --- fila: urgência primeiro, depois prioridade de carga, depois chegada; terminados no fim
  const queue = (await api('GET', '/processes', { token: loja })).body.processes;
  assert.deepEqual(queue.slice(0, 3).map((p) => p.id), [again.body.process.id, perishable.body.process.id, p1.id]);
  const mine = (await api('GET', '/processes', { token: fwdA })).body.processes;
  assert.equal(mine[0].id, foreign.body.process.id, 'transitário vê os mais recentes primeiro');
  assert.equal((await api('GET', '/processes', { token: fwdB })).body.processes.length, 0);
  assert.equal((await api('GET', `/processes/${p1.id}`, { token: fwdB })).status, 404);

  // --- análise
  assert.equal((await api('POST', `/processes/${p1.id}/transition`, { token: fwdA, body: { status: 'EM_ANALISE' } })).status, 403);
  const fat = await login('fat@cabinda.ao', 'Senha1234');
  assert.equal((await api('POST', `/processes/${p1.id}/transition`, { token: fat, body: { status: 'EM_ANALISE' } })).status, 403);
  assert.equal((await api('POST', `/processes/${p1.id}/transition`, { token: loja, body: { status: 'DOCUMENTOS_PENDENTES', notes: 'x' } })).status, 409);
  const analysing = await api('POST', `/processes/${p1.id}/transition`, { token: loja, body: { status: 'EM_ANALISE' } });
  assert.equal(analysing.body.process.status, 'EM_ANALISE');
  assert.equal((await api('POST', `/processes/${p1.id}/transition`, { token: loja, body: { status: 'DOCUMENTOS_PENDENTES' } })).status, 400);

  // transitário não anexa documentos fora do pedido
  const addDoc = (token, kind = 'BL') => {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', PDF(), 'bl.pdf');
    return api('POST', `/processes/${p1.id}/documents`, { token, form: fd });
  };
  assert.equal((await addDoc(fwdA)).status, 409);

  const requested = await api('POST', `/processes/${p1.id}/transition`, {
    token: loja,
    body: { status: 'DOCUMENTOS_PENDENTES', notes: 'Falta o BL' },
  });
  assert.equal(requested.body.process.statusNotes, 'Falta o BL');
  assert.equal((await api('POST', `/processes/${p1.id}/submit-documents`, { token: fwdA })).status, 400); // nada novo
  assert.equal((await addDoc(fwdB)).status, 404);
  assert.equal((await addDoc(fwdA)).status, 201);
  const resubmitted = await api('POST', `/processes/${p1.id}/submit-documents`, { token: fwdA });
  assert.equal(resubmitted.body.process.status, 'DOCUMENTOS_SUBMETIDOS');
  assert.deepEqual(resubmitted.body.process.history.map((h) => h.toStatus), [
    'SUBMETIDO', 'EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'DOCUMENTOS_SUBMETIDOS',
  ]);
  // --- correções detalhadas: documento recusado, documento em falta e campo errado
  const ep17 = resubmitted.body.process.documents.find((d) => d.kind === 'EP17');
  const issues = [
    { kind: 'DOCUMENTO', documentId: ep17.id, reason: 'Ilegível' },
    { kind: 'EM_FALTA', documentKind: 'ALVARA', reason: 'Obrigatório para a importação' },
    { kind: 'CAMPO', field: 'duNumber', reason: 'Não corresponde ao DU do documento' },
  ];
  const pathOf = (suffix) => `/processes/${p1.id}/${suffix}`;
  const badIssue = await api('POST', pathOf('transition'), {
    token: loja,
    body: { status: 'DOCUMENTOS_PENDENTES', issues: [{ kind: 'DOCUMENTO', documentId: 999999, reason: 'Ilegível' }] },
  });
  assert.equal(badIssue.status, 400, 'documento tem de ser do processo');
  const round = (await api('POST', pathOf('transition'), { token: loja, body: { status: 'DOCUMENTOS_PENDENTES', issues } })).body.process;
  assert.equal(round.status, 'DOCUMENTOS_PENDENTES');
  assert.equal(round.issues.filter((i) => !i.closedAt).length, 3);
  assert.match(round.statusNotes, /EP17 .* — Ilegível; Em falta: Alvará comercial — Obrigatório.*N\.º do DU — Não corresponde/);

  const pending = await api('POST', pathOf('submit-documents'), { token: fwdA });
  assert.equal(pending.body.error.code, 'ISSUES_PENDING');
  assert.equal(pending.body.error.details.length, 3);
  assert.equal((await api('PATCH', pathOf('fields'), { token: fwdA, body: { blNumber: 'BL-OUTRO' } })).body.error.code, 'FIELD_NOT_REQUESTED');
  assert.equal((await api('PATCH', pathOf('fields'), { token: loja, body: { duNumber: 'X' } })).status, 403);
  const corrected = (await api('PATCH', pathOf('fields'), { token: fwdA, body: { duNumber: '2026R7000' } })).body.process;
  assert.equal(corrected.duNumber, '2026R7000');
  const fieldIssue = corrected.issues.find((i) => i.field === 'duNumber');
  assert.deepEqual([fieldIssue.oldValue, fieldIssue.newValue, !!fieldIssue.fixedAt], ['2026R6028', '2026R7000', true]);
  assert.equal((await addDoc(fwdA, 'EP17')).status, 201);
  assert.equal((await api('POST', pathOf('submit-documents'), { token: fwdA })).body.error.details.length, 1, 'falta o alvará');
  assert.equal((await addDoc(fwdA, 'ALVARA')).status, 201);
  const fixed = (await api('POST', pathOf('submit-documents'), { token: fwdA })).body.process;
  assert.equal(fixed.status, 'DOCUMENTOS_SUBMETIDOS');
  assert.ok(fixed.issues.every((i) => i.closedAt), 'ronda encerrada');
  assert.match(fixed.history.at(-1).notes, /^Corrigido: /, 'o histórico regista as correções');

  const rejected = await api('POST', `/processes/${p1.id}/transition`, { token: admin, body: { status: 'REJEITADO', notes: 'Documentos ilegíveis' } });
  assert.equal(rejected.body.process.status, 'REJEITADO');

  // --- download de documentos: autenticado e com controlo de acesso
  const doc = resubmitted.body.process.documents[0];
  const url = `/api/v1/processes/${p1.id}/documents/${doc.id}`;
  const ok = await raw('GET', url, { token: fwdA });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.match(await ok.text(), /^%PDF/);
  assert.equal((await raw('GET', url, { token: loja })).status, 200);
  assert.equal((await raw('GET', url, { token: fwdB })).status, 404);
  assert.equal((await raw('GET', url)).status, 401);
  const stored = fs.readdirSync(documentsDir)[0];
  assert.equal((await raw('GET', `/uploads/documents/${stored}`)).status, 404, 'documentos não são públicos');

  // --- tipos de ficheiro
  const exe = new FormData();
  exe.append('data', JSON.stringify(cargo()));
  exe.append('ep17', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'x.exe');
  assert.equal((await api('POST', '/processes', { token: fwdA, form: exe })).status, 400);

  // --- indicadores do painel, limitados ao alcance de cada utilizador
  const stats = (await api('GET', '/processes/stats', { token: loja })).body.stats;
  assert.equal(stats.total, 6);
  assert.equal(stats.active, 5);
  assert.equal(stats.urgent, 1);
  assert.equal(stats.perishable, 1);
  assert.equal(stats.byStatus.REJEITADO, 1);
  assert.equal((await api('GET', '/processes/stats', { token: fwdB })).body.stats.total, 0);
  assert.equal((await api('GET', '/processes/stats')).status, 401);
});
