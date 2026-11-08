import bcrypt from 'bcryptjs';
import { pool, query, queryOne } from '../db/pool.js';
import { HttpError, badRequest, forbidden, unauthorized } from '../errors.js';
import { openTerminalsSql, resolveTerminal, signToken } from '../middleware/auth.js';
import { audit } from './audit.js';

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  entityId: u.entityId ?? u.entity_id ?? null,
  forwarderId: u.forwarderId ?? u.forwarder_id ?? null,
  emailNotifications: !!(u.emailNotifications ?? u.email_notifications ?? 1),
  canManageTerminals: !!(u.canManageTerminals ?? u.can_manage_terminals ?? 0),
  terminal: u.terminal ?? null,
});

/** O transitário precisa de estar dentro de um terminal para ver e tratar processos. */
export const terminalRequired = () =>
  new HttpError(409, 'TERMINAL_REQUIRED', 'Escolha o terminal em que quer trabalhar');

/** Todos os terminais do transitário, com o estado do vínculo (os não aprovados aparecem mas não abrem). */
export async function forwarderTerminals(user) {
  if (!user.forwarderId) throw forbidden('Só para transitários');
  const rows = await query(
    `SELECT e.id, e.code, e.name, e.location, e.active, fe.status
       FROM forwarder_entities fe JOIN entities e ON e.id = fe.entity_id
      WHERE fe.forwarder_id = ? ORDER BY e.name`,
    [user.forwarderId],
  );
  return rows.map((r) => ({ ...r, active: !!r.active, open: !!r.active && r.status === 'APROVADO' }));
}

/** Entra num terminal: devolve um token novo que limita a sessão a esse terminal. */
export async function selectTerminal(user, entityId) {
  if (!user.forwarderId) throw forbidden('Só para transitários');
  const [terminal] = await query(`${openTerminalsSql} AND e.id = ?`, [user.forwarderId, entityId]);
  if (!terminal) throw forbidden('Não está aprovado neste terminal ou o terminal está inativo');
  await audit(user, 'TERMINAL_SELECTED', 'entity', entityId, { entityId });
  return { token: signToken(user, entityId), user: publicUser({ ...user, terminal, terminalId: terminal.id }) };
}

export async function login(email, password) {
  const row = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
  // Compara sempre um hash para não revelar por tempo de resposta se o e-mail existe.
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
  const ok = await bcrypt.compare(password, hash);
  if (!row || !ok || !row.active) throw unauthorized('E-mail ou palavra-passe incorretos');

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);
  // Transitário com um só terminal aberto entra direto; com vários, escolhe a seguir (como JUP / Portal).
  const terminal = row.forwarder_id ? await resolveTerminal(row.forwarder_id) : null;
  return { token: signToken(row, terminal?.id), user: publicUser({ ...row, terminal }) };
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
