import bcrypt from 'bcryptjs';
import { pool, queryOne } from '../db/pool.js';
import { badRequest, unauthorized } from '../errors.js';
import { signToken } from '../middleware/auth.js';
import { audit } from './audit.js';

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  entityId: u.entityId ?? u.entity_id ?? null,
  forwarderId: u.forwarderId ?? u.forwarder_id ?? null,
  emailNotifications: !!(u.emailNotifications ?? u.email_notifications ?? 1),
});

export async function login(email, password) {
  const row = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
  // Compara sempre um hash para não revelar por tempo de resposta se o e-mail existe.
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
  const ok = await bcrypt.compare(password, hash);
  if (!row || !ok || !row.active) throw unauthorized('E-mail ou palavra-passe incorretos');

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);
  return { token: signToken(row), user: publicUser(row) };
}

export async function changePassword(user, currentPassword, newPassword) {
  const row = await queryOne('SELECT password_hash FROM users WHERE id = ?', [user.id]);
  if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
    throw badRequest('Palavra-passe atual incorreta', 'WRONG_PASSWORD');
  }
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), user.id]);
  await audit(user, 'PASSWORD_CHANGED', 'user', user.id);
}

export { publicUser };
