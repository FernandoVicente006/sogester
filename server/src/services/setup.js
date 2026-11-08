import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { queryOne, withTransaction } from '../db/pool.js';
import { conflict, forbidden } from '../errors.js';
import { ROLES } from '../roles.js';
import { audit } from './audit.js';
import { publicUser } from './auth.js';

function tokenMatches(provided) {
  if (!config.setupToken || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(config.setupToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A inicialização só está disponível antes de existir o super administrador e com o token configurado. */
export async function setupStatus() {
  const done = await queryOne('SELECT id FROM system_setup WHERE id = 1');
  return { available: !done && !!config.setupToken };
}

/**
 * Inicialização única da plataforma: cria o super administrador da Sogester e fecha o setup para sempre.
 * Os administradores dos terminais e os novos terminais são depois criados dentro da plataforma.
 */
export async function createSuperAdmin(setupToken, { name, email, password }) {
  if (!tokenMatches(setupToken)) throw forbidden('Token de inicialização inválido ou desativado');
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await withTransaction(async (conn) => {
    // A chave primária garante que só um pedido conclui o setup, mesmo em simultâneo.
    try {
      await conn.query('INSERT INTO system_setup (id) VALUES (1)');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict('A plataforma já foi inicializada', 'SETUP_CLOSED');
      throw err;
    }
    const [[existing]] = await conn.query('SELECT id FROM users WHERE role = ?', [ROLES.SUPER_ADMIN]);
    if (existing) throw conflict('A plataforma já foi inicializada', 'SETUP_CLOSED');
    const [[taken]] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (taken) throw conflict('E-mail já registado', 'EMAIL_TAKEN');

    const [res] = await conn.query('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [
      name,
      email,
      passwordHash,
      ROLES.SUPER_ADMIN,
    ]);
    await conn.query('UPDATE system_setup SET completed_by = ? WHERE id = 1', [res.insertId]);
    const created = { id: res.insertId, name, email, role: ROLES.SUPER_ADMIN, entityId: null, forwarderId: null };
    await audit(created, 'PLATFORM_INITIALIZED', 'user', created.id, { conn });
    return created;
  });
  return publicUser(user);
}
