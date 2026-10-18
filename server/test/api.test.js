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

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const login = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).body.token;

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

test('fluxo completo: entidades, perfis e transitários', async () => {
  // --- setup do admin de Cabinda
  const noToken = await api('POST', '/setup/entity-admin', {
    body: { entityCode: 'CABINDA', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' },
  });
  assert.equal(noToken.status, 403);

  const setupBody = { entityCode: 'cabinda', name: 'Diretor', email: 'dir@cabinda.ao', password: 'Senha1234' };
  const setup = await api('POST', '/setup/entity-admin', { body: setupBody, headers: { 'x-setup-token': 'test-setup-token' } });
  assert.equal(setup.status, 201);
  assert.equal(setup.body.user.role, 'ADMIN_ENTIDADE');

  const again = await api('POST', '/setup/entity-admin', {
    body: { ...setupBody, email: 'outro@cabinda.ao' },
    headers: { 'x-setup-token': 'test-setup-token' },
  });
  assert.equal(again.status, 409);

  const soyoInactive = await api('POST', '/setup/entity-admin', {
    body: { ...setupBody, entityCode: 'SOYO', email: 'dir@soyo.ao' },
    headers: { 'x-setup-token': 'test-setup-token' },
  });
  assert.equal(soyoInactive.status, 409);

  // --- login
  assert.equal((await api('POST', '/auth/login', { body: { email: 'dir@cabinda.ao', password: 'errada123' } })).status, 401);
  const adminToken = await login('dir@cabinda.ao', 'Senha1234');
  const me = await api('GET', '/auth/me', { token: adminToken });
  assert.equal(me.body.user.entityId, 1);
  assert.equal((await api('GET', '/auth/me')).status, 401);

  // --- funcionários
  const cadastro = await api('POST', '/users', {
    token: adminToken,
    body: { name: 'Ana', email: 'ana@cabinda.ao', password: 'Senha1234', role: 'CADASTRO' },
  });
  assert.equal(cadastro.status, 201);
  assert.equal(cadastro.body.user.entityId, 1);

  const escalation = await api('POST', '/users', {
    token: adminToken,
    body: { name: 'X', email: 'x@cabinda.ao', password: 'Senha1234', role: 'ADMIN_ENTIDADE' },
  });
  assert.equal(escalation.status, 403);

  const lojaToken = await (async () => {
    await api('POST', '/users', {
      token: adminToken,
      body: { name: 'Loja', email: 'loja@cabinda.ao', password: 'Senha1234', role: 'LOJA' },
    });
    return login('loja@cabinda.ao', 'Senha1234');
  })();
  assert.equal((await api('GET', '/users', { token: lojaToken })).status, 403);

  // --- transitário (criado pelo cadastro)
  const cadastroToken = await login('ana@cabinda.ao', 'Senha1234');
  const created = await api('POST', '/forwarders', {
    token: cadastroToken,
    body: {
      name: 'Sonacargos Transitários',
      nif: '5417000123',
      email: 'geral@sonacargos.ao',
      location: 'Cabinda',
      user: { name: 'Carlos', email: 'carlos@sonacargos.ao', password: 'Senha1234' },
    },
  });
  assert.equal(created.status, 201);
  const fwd = created.body.forwarder;
  assert.equal(fwd.entities[0].status, 'PENDENTE');

  const dup = await api('POST', '/forwarders', {
    token: cadastroToken,
    body: { name: 'Outro', nif: '5417000123', email: 'o@o.ao', location: 'Cabinda' },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'NIF_EXISTS');

  const invalid = await api('POST', '/forwarders', { token: cadastroToken, body: { name: 'x' } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');

  // loja não gere transitários
  assert.equal((await api('POST', '/forwarders', { token: lojaToken, body: {} })).status, 403);

  // rejeitar exige motivo; aprovar não
  const noReason = await api('PUT', `/forwarders/${fwd.id}/entities/1`, { token: cadastroToken, body: { status: 'REJEITADO' } });
  assert.equal(noReason.status, 400);
  const approved = await api('PUT', `/forwarders/${fwd.id}/entities/1`, { token: cadastroToken, body: { status: 'APROVADO' } });
  assert.equal(approved.body.forwarder.entities[0].status, 'APROVADO');

  // --- isolamento por entidade: ativar Soyo e criar admin
  const superToken = await login(config.seed.superAdminEmail, config.seed.superAdminPassword);
  assert.equal((await api('PATCH', '/entities/2', { token: superToken, body: { active: true } })).status, 200);
  assert.equal((await api('PATCH', '/entities/2', { token: adminToken, body: { active: false } })).status, 403);

  await api('POST', '/setup/entity-admin', {
    body: { entityCode: 'SOYO', name: 'Diretor Soyo', email: 'dir@soyo.ao', password: 'Senha1234' },
    headers: { 'x-setup-token': 'test-setup-token' },
  });
  const soyoToken = await login('dir@soyo.ao', 'Senha1234');

  assert.equal((await api('GET', `/forwarders/${fwd.id}`, { token: soyoToken })).status, 404);
  assert.deepEqual((await api('GET', '/forwarders', { token: soyoToken })).body.forwarders, []);
  assert.equal((await api('GET', '/users', { token: soyoToken })).body.users.length, 1);
  assert.equal((await api('PATCH', '/users/2', { token: soyoToken, body: { active: false } })).status, 404);
  assert.equal((await api('PUT', `/forwarders/${fwd.id}/entities/1`, { token: soyoToken, body: { status: 'SUSPENSO', notes: 'x' } })).status, 403);

  // transitário opera também em Soyo: vínculo por NIF, validado separadamente
  const linked = await api('POST', '/forwarders/link', { token: soyoToken, body: { nif: '5417000123' } });
  assert.equal(linked.status, 201);
  assert.equal(linked.body.forwarder.entities.length, 1); // staff Soyo só vê o seu vínculo
  assert.equal(linked.body.forwarder.entities[0].entityCode, 'SOYO');
  assert.equal(linked.body.forwarder.entities[0].status, 'PENDENTE');

  // --- utilizador transitário
  const fwdToken = await login('carlos@sonacargos.ao', 'Senha1234');
  const own = await api('GET', '/forwarders', { token: fwdToken });
  assert.equal(own.body.forwarders.length, 1);
  assert.equal(own.body.forwarders[0].entities.length, 2); // vê todos os seus vínculos
  assert.equal((await api('GET', '/users', { token: fwdToken })).status, 403);
  assert.equal((await api('POST', '/forwarders', { token: fwdToken, body: {} })).status, 403);
  const edit = await api('PATCH', `/forwarders/${fwd.id}`, { token: fwdToken, body: { phone: '923000000' } });
  assert.equal(edit.body.forwarder.phone, '923000000');
  assert.equal((await api('PATCH', `/forwarders/${fwd.id}`, { token: fwdToken, body: { active: false } })).status, 403);

  // conta desativada perde acesso imediatamente
  assert.equal((await api('PATCH', `/users/${cadastro.body.user.id}`, { token: adminToken, body: { active: false } })).status, 200);
  assert.equal((await api('GET', '/auth/me', { token: cadastroToken })).status, 401);

  // super admin pode desativar o admin de uma entidade
  assert.equal((await api('PATCH', `/users/${me.body.user.id}`, { token: superToken, body: { active: false } })).status, 200); // super admin pode
});
