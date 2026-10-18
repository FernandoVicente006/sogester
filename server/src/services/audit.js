import { pool } from '../db/pool.js';

/** Regista uma ação. `conn` permite fazê-lo dentro de uma transação. */
export async function audit(actor, action, targetType, targetId, { entityId = null, details = null, conn = pool } = {}) {
  await conn.query(
    'INSERT INTO audit_log (entity_id, user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    [entityId ?? actor?.entityId ?? null, actor?.id ?? null, action, targetType, String(targetId ?? ''), details ? JSON.stringify(details) : null],
  );
}
