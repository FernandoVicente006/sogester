import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../errors.js';
import { query, queryOne } from '../db/pool.js';

/** `terminalId`: terminal em que o transitário entrou (fica assinado no token). */
export function signToken(user, terminalId) {
  const payload = terminalId ? { sub: user.id, ent: terminalId } : { sub: user.id };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Terminais onde o transitário pode trabalhar agora: vínculo aprovado e terminal ativo. */
export const openTerminalsSql = `
  SELECT e.id, e.code, e.name, e.location
    FROM forwarder_entities fe JOIN entities e ON e.id = fe.entity_id
   WHERE fe.forwarder_id = ? AND fe.status = 'APROVADO' AND e.active = 1`;

/**
 * Terminal de trabalho do transitário: o escolhido no token, se ainda estiver aprovado e ativo;
 * sem escolha, o único terminal aberto (quem só tem um não precisa de escolher).
 */
export async function resolveTerminal(forwarderId, chosen) {
  if (chosen) return queryOne(`${openTerminalsSql} AND e.id = ?`, [forwarderId, chosen]);
  const open = await query(`${openTerminalsSql} LIMIT 2`, [forwarderId]);
  return open.length === 1 ? open[0] : null;
}

/** Valida o JWT e carrega o utilizador atual da BD (conta desativada perde acesso de imediato). */
export async function authenticate(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Sessão inválida ou expirada');
  }

  const row = await queryOne(
    `SELECT id, name, email, role, entity_id AS entityId, forwarder_id AS forwarderId, active,
            email_notifications AS emailNotifications, can_manage_terminals AS canManageTerminals
       FROM users WHERE id = ?`,
    [payload.sub],
  );
  if (!row || !row.active) throw unauthorized('Conta inexistente ou desativada');
  if (row.forwarderId) {
    row.terminal = await resolveTerminal(row.forwarderId, payload.ent);
    row.terminalId = row.terminal?.id ?? null;
  }
  req.user = row;
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
