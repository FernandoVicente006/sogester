import { pool, query, queryOne } from '../db/pool.js';
import { notFound } from '../errors.js';
import { audit } from './audit.js';

const SELECT = 'SELECT id, code, name, location, active FROM entities';
const map = (e) => ({ ...e, active: !!e.active });

export async function listEntities() {
  const rows = await query(`${SELECT} ORDER BY id`);
  return rows.map(map);
}

export async function getEntity(id) {
  const row = await queryOne(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw notFound('Entidade não encontrada');
  return map(row);
}

export async function updateEntity(actor, id, { name, active }) {
  await getEntity(id);
  const sets = [];
  const params = [];
  if (name !== undefined) (sets.push('name = ?'), params.push(name));
  if (active !== undefined) (sets.push('active = ?'), params.push(active ? 1 : 0));
  if (sets.length) {
    await pool.query(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    await audit(actor, 'ENTITY_UPDATED', 'entity', id, { entityId: id, details: { name, active } });
  }
  return getEntity(id);
}
