import bcrypt from 'bcryptjs';
import { pool, query, queryOne } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { ASSIGNABLE_ROLES, ROLES, isSuperAdmin } from '../roles.js';
import { audit } from './audit.js';

const SELECT = `SELECT id, name, email, role, entity_id AS entityId, forwarder_id AS forwarderId, active,
                       last_login_at AS lastLoginAt, created_at AS createdAt FROM users`;
const map = (u) => ({ ...u, active: !!u.active });

/** Perfis que o ator pode atribuir ao criar/editar utilizadores de staff. */
function assignableRoles(actor) {
  return isSuperAdmin(actor) ? [ROLES.ADMIN_ENTIDADE, ...ASSIGNABLE_ROLES] : ASSIGNABLE_ROLES;
}

/** Carrega o utilizador alvo garantindo que o ator tem alcance sobre ele (mesma entidade). */
async function loadManageable(actor, id) {
  const target = await queryOne(`${SELECT} WHERE id = ?`, [id]);
  if (!target) throw notFound('Utilizador não encontrado');
  if (target.role === ROLES.TRANSITARIO || target.role === ROLES.SUPER_ADMIN) {
    if (!isSuperAdmin(actor)) throw notFound('Utilizador não encontrado');
  }
  if (!isSuperAdmin(actor)) {
    if (target.entityId !== actor.entityId) throw notFound('Utilizador não encontrado');
    if (target.role === ROLES.ADMIN_ENTIDADE) throw forbidden('Não pode gerir outro administrador');
  }
  return target;
}

export async function listUsers(actor, { entityId } = {}) {
  const scope = isSuperAdmin(actor) ? entityId ?? null : actor.entityId;
  const rows = scope
    ? await query(`${SELECT} WHERE entity_id = ? AND role <> 'TRANSITARIO' ORDER BY name`, [scope])
    : await query(`${SELECT} WHERE role <> 'TRANSITARIO' ORDER BY name`);
  return rows.map(map);
}

export async function createUser(actor, { name, email, password, role, entityId }) {
  if (!assignableRoles(actor).includes(role)) throw forbidden('Perfil não permitido para este utilizador');

  const targetEntity = isSuperAdmin(actor) ? entityId : actor.entityId;
  if (!targetEntity) throw badRequest('entityId é obrigatório', 'ENTITY_REQUIRED');
  if (!(await queryOne('SELECT id FROM entities WHERE id = ?', [targetEntity]))) throw notFound('Entidade não encontrada');
  if (await queryOne('SELECT id FROM users WHERE email = ?', [email])) throw conflict('E-mail já registado', 'EMAIL_TAKEN');

  const [res] = await pool.query(
    'INSERT INTO users (entity_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [targetEntity, name, email, await bcrypt.hash(password, 10), role],
  );
  await audit(actor, 'USER_CREATED', 'user', res.insertId, { entityId: targetEntity, details: { role } });
  return map(await queryOne(`${SELECT} WHERE id = ?`, [res.insertId]));
}

export async function updateUser(actor, id, { name, role, active, password }) {
  const target = await loadManageable(actor, id);
  if (role !== undefined && !assignableRoles(actor).includes(role)) throw forbidden('Perfil não permitido');
  if (target.id === actor.id && (active === false || role !== undefined)) {
    throw forbidden('Não pode alterar o seu próprio perfil ou estado');
  }

  const sets = [];
  const params = [];
  if (name !== undefined) (sets.push('name = ?'), params.push(name));
  if (role !== undefined) (sets.push('role = ?'), params.push(role));
  if (active !== undefined) (sets.push('active = ?'), params.push(active ? 1 : 0));
  if (password !== undefined) (sets.push('password_hash = ?'), params.push(await bcrypt.hash(password, 10)));
  if (sets.length) {
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    await audit(actor, 'USER_UPDATED', 'user', id, {
      entityId: target.entityId,
      details: { name, role, active, passwordReset: password !== undefined },
    });
  }
  return map(await queryOne(`${SELECT} WHERE id = ?`, [id]));
}
