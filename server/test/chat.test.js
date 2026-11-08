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
const docCount = () => fs.readdirSync(documentsDir).length;

function msg(text, files = [], types = {}) {
  const fd = new FormData();
  if (text !== undefined) fd.append('text', text);
  files.forEach((name, i) => fd.append('files', new Blob(['%PDF-1.4 x'], { type: types[name] ?? 'application/pdf' }), name));
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

test('chat por processo: acesso, anexos, não lidas e encerramento', async () => {
  const superToken = await bootstrapMaster(base);
  await createEntityAdmin(base, superToken, { entityCode: 'CABINDA', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' });
  const admin = await login('dir@cabinda.ao', 'Senha1234');
  for (const [name, role] of [['Loja', 'LOJA'], ['Fat', 'FINANCAS']]) {
    await api('POST', '/users', { token: admin, body: { name, email: `${role.toLowerCase()}@cabinda.ao`, password: 'Senha1234', role } });
  }
  const loja = await login('loja@cabinda.ao', 'Senha1234');
  const fat = await login('financas@cabinda.ao', 'Senha1234');

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

  // staff de outra entidade
  await api('PATCH', '/entities/2', { token: superToken, body: { active: true } });
  await createEntityAdmin(base, superToken, { entityCode: 'SOYO', name: 'Diretor Soyo', email: 'dir@soyo.ao', password: 'Senha1234' });
  const soyo = await login('dir@soyo.ao', 'Senha1234');

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
    }),
  );
  fd.append('ep17', PDF(), 'ep17.pdf');
  fd.append('bilhete', PDF(), 'bilhete.pdf');
  const p = (await api('POST', '/processes', { token: fwdA, form: fd })).body.process;
  const base_ = `/processes/${p.id}/messages`;
  assert.equal((await api('GET', `${base_}?after=0`, { token: fwdA })).status, 200, 'conversa vazia: a atualização periódica usa after=0');

  // --- envio e validações
  const first = await api('POST', base_, { token: fwdA, form: msg('Bom dia, segue o processo.') });
  assert.equal(first.status, 201);
  assert.equal(first.body.message.side, 'TRANSITARIO');
  assert.equal((await api('POST', base_, { token: fwdA, form: msg('   ') })).status, 400);
  assert.equal((await api('POST', base_, { token: fwdA, form: msg('x'.repeat(4001)) })).status, 400);

  const orphansBefore = docCount();
  assert.equal((await api('POST', base_, { token: fwdA, form: msg('ficheiro mau', ['x.exe'], { 'x.exe': 'application/x-msdownload' }) })).status, 400);
  assert.equal((await api('POST', base_, { token: fwdA, form: msg('muitos', ['1.pdf', '2.pdf', '3.pdf', '4.pdf']) })).status, 400);
  assert.equal(docCount(), orphansBefore, 'anexos de mensagens rejeitadas não ficam em disco');

  const withFile = await api('POST', base_, { token: fwdA, form: msg('Comprovativo em anexo', ['guia.pdf']) });
  assert.equal(withFile.status, 201);
  const att = withFile.body.message.attachments[0];
  assert.equal(att.originalName, 'guia.pdf');
  assert.equal((await api('POST', base_, { token: fwdA, form: msg(undefined, ['so-anexo.pdf']) })).status, 201); // só anexo

  // --- acesso
  assert.equal((await api('GET', base_, { token: fwdB })).status, 404);
  assert.equal((await api('POST', base_, { token: fwdB, form: msg('intruso') })).status, 404);
  assert.equal((await api('GET', base_, { token: soyo })).status, 404);
  assert.equal((await api('GET', base_)).status, 401);

  const history = (await api('GET', base_, { token: loja })).body.messages;
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((m) => m.id), [...history.map((m) => m.id)].sort((a, b) => a - b));

  // --- anexos privados
  const url = `${base}/api/v1${base_}/${withFile.body.message.id}/attachments/${att.id}`;
  const ok = await fetch(url, { headers: { authorization: `Bearer ${loja}` } });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /^%PDF/);
  assert.equal((await fetch(url, { headers: { authorization: `Bearer ${fwdA}` } })).status, 200);
  assert.equal((await fetch(url, { headers: { authorization: `Bearer ${fwdB}` } })).status, 404);
  assert.equal((await fetch(url)).status, 401);

  // --- não lidas (por utilizador)
  const unreadOf = async (token) => (await api('GET', '/messages/unread', { token })).body.total;
  const listUnread = async (token) => (await api('GET', '/processes', { token })).body.processes[0].unreadMessages;
  assert.equal(await unreadOf(loja), 3);
  assert.equal(await listUnread(loja), 3);
  assert.equal(await unreadOf(fwdA), 0, 'o autor não tem não lidas das próprias mensagens');
  assert.equal(await unreadOf(soyo), 0);

  assert.equal((await api('POST', `${base_}/read`, { token: loja })).status, 204);
  assert.equal(await unreadOf(loja), 0);
  assert.equal(await unreadOf(fat), 3, 'cada utilizador tem o seu estado de leitura');
  assert.equal((await api('GET', `/processes/${p.id}`, { token: loja })).body.process.unreadMessages, 0);

  // --- resposta da Sogester
  const reply = await api('POST', base_, { token: loja, form: msg('Falta o BL, por favor.') });
  assert.equal(reply.body.message.side, 'SOGESTER');
  assert.equal(await unreadOf(fwdA), 1);
  assert.equal(await unreadOf(loja), 0, 'quem responde fica em dia');
  const newer = (await api('GET', `${base_}?after=${withFile.body.message.id}`, { token: fwdA })).body.messages;
  assert.equal(newer.length, 2);
  assert.equal(newer.at(-1).body, 'Falta o BL, por favor.');
  await api('POST', `${base_}/read`, { token: fwdA });
  assert.equal(await unreadOf(fwdA), 0);

  // --- encerrado: só leitura
  await api('POST', `/processes/${p.id}/transition`, { token: loja, body: { status: 'REJEITADO', notes: 'Documentação inválida' } });
  const closed = await api('POST', base_, { token: fwdA, form: msg('ainda ali?') });
  assert.equal(closed.status, 409);
  assert.equal(closed.body.error.code, 'CHAT_CLOSED');
  assert.equal((await api('GET', base_, { token: fwdA })).body.messages.length, 4);
});
