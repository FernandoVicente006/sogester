import { pool, query, queryOne } from '../db/pool.js';
import { conflict, notFound } from '../errors.js';
import { isSuperAdmin } from '../roles.js';
import { audit } from './audit.js';

const SELECT = 'SELECT id, code, name, location, active FROM entities';
const map = (e) => ({ ...e, active: !!e.active });

/** Criar e editar terminais: o super administrador ou quem ele designar. */
export const canManageTerminals = (user) => isSuperAdmin(user) || !!user.canManageTerminals;

export async function listEntities() {
  const rows = await query(`${SELECT} ORDER BY id`);
  return rows.map(map);
}

export async function getEntity(id) {
  const row = await queryOne(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw notFound('Entidade não encontrada');
  return map(row);
}

/** Novo terminal: nasce inativo por omissão, para preparar os acessos antes de abrir aos transitários. */
export async function createEntity(actor, { code, name, location, active = false }) {
  if (await queryOne('SELECT id FROM entities WHERE code = ?', [code])) {
    throw conflict('Já existe um terminal com este código', 'ENTITY_CODE_TAKEN');
  }
  const [res] = await pool.query('INSERT INTO entities (code, name, location, active) VALUES (?, ?, ?, ?)', [
    code,
    name,
    location,
    active ? 1 : 0,
  ]);
  await audit(actor, 'ENTITY_CREATED', 'entity', res.insertId, { entityId: res.insertId, details: { code, name, location, active } });
  return getEntity(res.insertId);
}

export async function updateEntity(actor, id, { name, location, active }) {
  await getEntity(id);
  const sets = [];
  const params = [];
  if (name !== undefined) (sets.push('name = ?'), params.push(name));
  if (location !== undefined) (sets.push('location = ?'), params.push(location));
  if (active !== undefined) (sets.push('active = ?'), params.push(active ? 1 : 0));
  if (sets.length) {
    await pool.query(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    await audit(actor, 'ENTITY_UPDATED', 'entity', id, { entityId: id, details: { name, location, active } });
  }
  return getEntity(id);
}
