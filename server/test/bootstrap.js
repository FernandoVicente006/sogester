// Prepara a instalação de teste: setup único do super administrador e administradores dos terminais.
export const MASTER = { name: 'Administrador Geral', email: 'master@sogester.test', password: 'Master12345' };

async function call(base, method, path, { token, body, headers } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** Faz o setup do super administrador (uma única vez por base) e devolve o token dele. */
export async function bootstrapMaster(base) {
  await call(base, 'POST', '/setup/super-admin', { body: MASTER, headers: { 'x-setup-token': 'test-setup-token' } });
  return (await call(base, 'POST', '/auth/login', { body: { email: MASTER.email, password: MASTER.password } })).token;
}

/** O super administrador cria o administrador de um terminal (pelo código do terminal). */
export async function createEntityAdmin(base, superToken, { entityCode, name, email, password }) {
  const { entities } = await call(base, 'GET', '/entities', { token: superToken });
  const entity = entities.find((e) => e.code === entityCode.toUpperCase());
  return call(base, 'POST', '/users', { token: superToken, body: { name, email, password, role: 'ADMIN_ENTIDADE', entityId: entity.id } });
}
