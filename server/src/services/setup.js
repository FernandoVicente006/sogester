import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { pool, queryOne } from '../db/pool.js';
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

/**
 * Inicialização de uma entidade: cria o administrador interno (diretor-geral) e vincula-o
 * definitivamente ao terminal escolhido. Só funciona uma vez por entidade e com o token de setup.
 */
export async function createEntityAdmin(setupToken, { entityCode, name, email, password }) {
  if (!tokenMatches(setupToken)) throw forbidden('Token de inicialização inválido ou desativado');

  const entity = await queryOne('SELECT id, active FROM entities WHERE code = ?', [entityCode]);
  if (!entity) throw notFound('Entidade não encontrada');
  if (!entity.active) throw conflict('Esta entidade ainda não está ativa', 'ENTITY_INACTIVE');

  const existingAdmin = await queryOne('SELECT id FROM users WHERE entity_id = ? AND role = ?', [
    entity.id,
    ROLES.ADMIN_ENTIDADE,
  ]);
  if (existingAdmin) throw conflict('Esta entidade já tem administrador', 'ADMIN_EXISTS');
  if (await queryOne('SELECT id FROM users WHERE email = ?', [email])) {
    throw conflict('E-mail já registado', 'EMAIL_TAKEN');
  }

  const [res] = await pool.query(
    'INSERT INTO users (entity_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [entity.id, name, email, await bcrypt.hash(password, 10), ROLES.ADMIN_ENTIDADE],
  );
  const user = { id: res.insertId, name, email, role: ROLES.ADMIN_ENTIDADE, entityId: entity.id, forwarderId: null };
  await audit(user, 'ENTITY_ADMIN_CREATED', 'user', user.id, { entityId: entity.id });
  return publicUser(user);
}
