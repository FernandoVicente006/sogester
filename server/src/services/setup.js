import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { ROLES } from '../roles.js';
import { audit } from './audit.js';
import { publicUser } from './auth.js';

function tokenMatches(provided) {
  if (!config.setupToken || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(config.setupToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Terminais ativos que ainda não têm administrador; sem nenhum, a inicialização fica fechada. */
export async function setupStatus() {
  const entities = await query(
    `SELECT e.id, e.code, e.name FROM entities e
      WHERE e.active = 1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.entity_id = e.id AND u.role = ?)
      ORDER BY e.id`,
    [ROLES.ADMIN_ENTIDADE],
  );
  return { available: !!config.setupToken && entities.length > 0, entities };
}

/**
 * Inicialização de uma entidade: cria o administrador interno (diretor-geral) e vincula-o
 * definitivamente ao terminal escolhido. Só funciona uma vez por entidade e com o token de setup.
 */
export async function createEntityAdmin(setupToken, { entityCode, name, email, password }) {
  if (!tokenMatches(setupToken)) throw forbidden('Token de inicialização inválido ou desativado');
  const passwordHash = await bcrypt.hash(password, 10);

  // O bloqueio da entidade impede dois administradores em pedidos simultâneos.
  const user = await withTransaction(async (conn) => {
    const [[entity]] = await conn.query('SELECT id, active FROM entities WHERE code = ? FOR UPDATE', [entityCode]);
    if (!entity) throw notFound('Entidade não encontrada');
    if (!entity.active) throw conflict('Esta entidade ainda não está ativa', 'ENTITY_INACTIVE');

    const [[existingAdmin]] = await conn.query('SELECT id FROM users WHERE entity_id = ? AND role = ?', [entity.id, ROLES.ADMIN_ENTIDADE]);
    if (existingAdmin) throw conflict('Esta entidade já tem administrador', 'ADMIN_EXISTS');
    const [[taken]] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (taken) throw conflict('E-mail já registado', 'EMAIL_TAKEN');

    const [res] = await conn.query(
      'INSERT INTO users (entity_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [entity.id, name, email, passwordHash, ROLES.ADMIN_ENTIDADE],
    );
    const created = { id: res.insertId, name, email, role: ROLES.ADMIN_ENTIDADE, entityId: entity.id, forwarderId: null };
    await audit(created, 'ENTITY_ADMIN_CREATED', 'user', created.id, { entityId: entity.id, conn });
    return created;
  });
  return publicUser(user);
}
