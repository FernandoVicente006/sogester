import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../errors.js';
import { queryOne } from '../db/pool.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
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
    `SELECT id, name, email, role, entity_id AS entityId, forwarder_id AS forwarderId, active
       FROM users WHERE id = ?`,
    [payload.sub],
  );
  if (!row || !row.active) throw unauthorized('Conta inexistente ou desativada');
  req.user = row;
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
