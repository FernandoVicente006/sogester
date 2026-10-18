import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pool, query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { ROLES, isForwarder, isSuperAdmin } from '../roles.js';
import { audit } from './audit.js';

const FIELDS = `f.id, f.name, f.nif, f.email, f.phone, f.location, f.logo_path AS logoPath,
                f.extra_identifiers AS extraIdentifiers, f.active, f.created_at AS createdAt`;

const mapForwarder = (f) => ({
  ...f,
  active: !!f.active,
  extraIdentifiers: typeof f.extraIdentifiers === 'string' ? JSON.parse(f.extraIdentifiers) : f.extraIdentifiers ?? {},
});

/** Anexa os vínculos visíveis para o ator (staff só vê a sua entidade; super admin vê todos). */
async function attachLinks(actor, forwarders) {
  if (!forwarders.length) return forwarders;
  const ids = forwarders.map((f) => f.id);
  const scoped = !isSuperAdmin(actor) && !isForwarder(actor);
  const rows = await query(
    `SELECT fe.forwarder_id AS forwarderId, fe.entity_id AS entityId, e.code AS entityCode, e.name AS entityName,
            fe.status, fe.notes, fe.reviewed_at AS reviewedAt
       FROM forwarder_entities fe JOIN entities e ON e.id = fe.entity_id
      WHERE fe.forwarder_id IN (?) ${scoped ? 'AND fe.entity_id = ?' : ''}
      ORDER BY e.id`,
    scoped ? [ids, actor.entityId] : [ids],
  );
  return forwarders.map((f) => ({
    ...f,
    entities: rows.filter((r) => r.forwarderId === f.id).map(({ forwarderId, ...link }) => link),
  }));
}

/** Garante que o ator pode ver/gerir o transitário e devolve-o. */
async function loadAccessible(actor, id) {
  const f = await queryOne(`SELECT ${FIELDS} FROM forwarders f WHERE f.id = ?`, [id]);
  if (!f) throw notFound('Transitário não encontrado');

  if (isForwarder(actor)) {
    if (actor.forwarderId !== f.id) throw notFound('Transitário não encontrado');
  } else if (!isSuperAdmin(actor)) {
    const link = await queryOne('SELECT 1 AS ok FROM forwarder_entities WHERE forwarder_id = ? AND entity_id = ?', [
      id,
      actor.entityId,
    ]);
    if (!link) throw notFound('Transitário não encontrado');
  }
  return mapForwarder(f);
}

export async function listForwarders(actor, { status, q, entityId } = {}) {
  const where = [];
  const params = [];
  let join = '';

  if (isForwarder(actor)) {
    where.push('f.id = ?');
    params.push(actor.forwarderId);
  } else {
    const scope = isSuperAdmin(actor) ? entityId ?? null : actor.entityId;
    if (scope) {
      join = 'JOIN forwarder_entities fe ON fe.forwarder_id = f.id AND fe.entity_id = ?';
      params.push(scope);
      if (status) (where.push('fe.status = ?'), params.push(status));
    }
  }
  if (q) {
    where.push('(f.name LIKE ? OR f.nif LIKE ? OR f.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = await query(
    `SELECT ${FIELDS} FROM forwarders f ${join} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY f.name`,
    params,
  );
  return attachLinks(actor, rows.map(mapForwarder));
}

export async function getForwarder(actor, id) {
  const f = await loadAccessible(actor, id);
  const [withLinks] = await attachLinks(actor, [f]);
  return withLinks;
}

/** Cadastro de transitário pela Sogester; fica PENDENTE até a entidade verificar a documentação. */
export async function createForwarder(actor, input) {
  const entityIds = isSuperAdmin(actor) ? [...new Set(input.entityIds ?? [])] : [actor.entityId];
  if (!entityIds.length) throw badRequest('Indique pelo menos uma entidade', 'ENTITY_REQUIRED');

  const entities = await query('SELECT id, active FROM entities WHERE id IN (?)', [entityIds]);
  if (entities.length !== entityIds.length) throw notFound('Entidade não encontrada');
  if (entities.some((e) => !e.active)) throw conflict('Entidade inativa', 'ENTITY_INACTIVE');

  if (await queryOne('SELECT id FROM forwarders WHERE nif = ?', [input.nif])) {
    throw conflict('Já existe um transitário com este NIF; use a ligação por NIF', 'NIF_EXISTS');
  }
  if (input.user && (await queryOne('SELECT id FROM users WHERE email = ?', [input.user.email]))) {
    throw conflict('E-mail do utilizador já registado', 'EMAIL_TAKEN');
  }

  const forwarderId = await withTransaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO forwarders (name, nif, email, phone, location, extra_identifiers) VALUES (?, ?, ?, ?, ?, ?)`,
      [input.name, input.nif, input.email, input.phone ?? null, input.location, JSON.stringify(input.extraIdentifiers ?? {})],
    );
    for (const entityId of entityIds) {
      await conn.query('INSERT INTO forwarder_entities (forwarder_id, entity_id) VALUES (?, ?)', [res.insertId, entityId]);
    }
    if (input.user) {
      await conn.query(
        'INSERT INTO users (forwarder_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [res.insertId, input.user.name, input.user.email, await bcrypt.hash(input.user.password, 10), ROLES.TRANSITARIO],
      );
    }
    await audit(actor, 'FORWARDER_CREATED', 'forwarder', res.insertId, {
      entityId: entityIds[0],
      details: { entityIds },
      conn,
    });
    return res.insertId;
  });
  return getForwarder(actor, forwarderId);
}

/** Vincula um transitário já existente (outra entidade) à entidade do ator, por NIF. */
export async function linkByNif(actor, nif) {
  if (isSuperAdmin(actor) || !actor.entityId) throw forbidden('Apenas staff de uma entidade pode vincular transitários');
  const f = await queryOne('SELECT id FROM forwarders WHERE nif = ?', [nif]);
  if (!f) throw notFound('Nenhum transitário com este NIF');
  if (await queryOne('SELECT 1 AS ok FROM forwarder_entities WHERE forwarder_id = ? AND entity_id = ?', [f.id, actor.entityId])) {
    throw conflict('Transitário já vinculado a esta entidade', 'ALREADY_LINKED');
  }
  await pool.query('INSERT INTO forwarder_entities (forwarder_id, entity_id) VALUES (?, ?)', [f.id, actor.entityId]);
  await audit(actor, 'FORWARDER_LINKED', 'forwarder', f.id);
  return getForwarder(actor, f.id);
}

export async function updateForwarder(actor, id, input) {
  const current = await loadAccessible(actor, id);
  const sets = [];
  const params = [];
  for (const [field, column] of [['name', 'name'], ['email', 'email'], ['phone', 'phone'], ['location', 'location']]) {
    if (input[field] !== undefined) (sets.push(`${column} = ?`), params.push(input[field]));
  }
  if (input.extraIdentifiers !== undefined) {
    sets.push('extra_identifiers = ?');
    params.push(JSON.stringify(input.extraIdentifiers));
  }
  if (input.active !== undefined) {
    if (isForwarder(actor)) throw forbidden();
    sets.push('active = ?');
    params.push(input.active ? 1 : 0);
  }
  if (sets.length) {
    await pool.query(`UPDATE forwarders SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    await audit(actor, 'FORWARDER_UPDATED', 'forwarder', id, { details: { fields: Object.keys(input) } });
  }
  return getForwarder(actor, current.id);
}

/** Aprova/rejeita/suspende o transitário numa entidade (cada entidade valida separadamente). */
export async function setLinkStatus(actor, forwarderId, entityId, { status, notes }) {
  if (!isSuperAdmin(actor) && actor.entityId !== entityId) throw forbidden('Só pode validar na sua entidade');
  const link = await queryOne('SELECT status FROM forwarder_entities WHERE forwarder_id = ? AND entity_id = ?', [
    forwarderId,
    entityId,
  ]);
  if (!link) throw notFound('Vínculo não encontrado');
  if (['REJEITADO', 'SUSPENSO'].includes(status) && !notes) {
    throw badRequest('Indique o motivo', 'NOTES_REQUIRED');
  }

  await pool.query(
    'UPDATE forwarder_entities SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE forwarder_id = ? AND entity_id = ?',
    [status, notes ?? null, actor.id, forwarderId, entityId],
  );
  await audit(actor, 'FORWARDER_STATUS_CHANGED', 'forwarder', forwarderId, {
    entityId,
    details: { from: link.status, to: status, notes },
  });
  return getForwarder(actor, forwarderId);
}

export async function setLogo(actor, id, file) {
  const f = await loadAccessible(actor, id);
  const previous = f.logoPath;
  await pool.query('UPDATE forwarders SET logo_path = ? WHERE id = ?', [`logos/${file.filename}`, id]);
  if (previous) await fs.rm(path.join(file.destination, path.basename(previous)), { force: true });
  await audit(actor, 'FORWARDER_LOGO_CHANGED', 'forwarder', id);
  return getForwarder(actor, id);
}

/** Transitários aprovados numa entidade (base para a submissão de processos). */
export async function isApprovedIn(forwarderId, entityId) {
  const row = await queryOne(
    "SELECT 1 AS ok FROM forwarder_entities WHERE forwarder_id = ? AND entity_id = ? AND status = 'APROVADO'",
    [forwarderId, entityId],
  );
  return !!row;
}
