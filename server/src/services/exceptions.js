import { queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { isForwarder } from '../roles.js';
import { audit } from './audit.js';
import { notifyProcessEvent } from './notifications.js';
import { MAX_EXTENSIONS, changeStatus, getProcess, loadAccessible } from './processes.js';

/** Antes da autorização o transitário desiste sozinho; depois, só com decisão da Sogester. */
const PRE_AUTHORIZATION = ['SUBMETIDO', 'EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'DOCUMENTOS_SUBMETIDOS'];
const POST_AUTHORIZATION = ['AUTORIZACAO_EMITIDA', 'PAGAMENTO_PENDENTE', 'PAGAMENTO_SUBMETIDO'];
const PAID = ['PAGAMENTO_CONFIRMADO', 'CONCLUIDO'];

const activeAuthorization = (processId) =>
  queryOne('SELECT id, type FROM authorizations WHERE process_id = ? AND revoked_at IS NULL', [processId]);

/** Saída antecipada: a carga pode já ter saído contra o compromisso de pagamento, por isso a dívida não se apaga. */
async function assertNotEarlyRelease(processId) {
  const auth = await activeAuthorization(processId);
  if (auth?.type === 'SAIDA_ANTECIPADA') {
    throw conflict('Carga libertada com compromisso de pagamento: o processo tem de ser liquidado', 'EARLY_RELEASE_BINDING');
  }
}

const closeProcess = async (conn, actor, process, notes) => {
  await changeStatus(actor, process, 'CANCELADO', notes, conn);
};

// ---- cancelamento -------------------------------------------------------------------------
/**
 * Transitário: cancela de imediato antes da autorização; depois dela cria um pedido para a Sogester decidir.
 */
export async function cancelOrRequest(actor, id, { reason }) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);

  if (PRE_AUTHORIZATION.includes(process.status)) {
    await withTransaction(async (conn) => {
      await closeProcess(conn, actor, process, reason);
      await audit(actor, 'PROCESS_WITHDRAWN', 'process', id, { entityId: process.entityId, details: { reason }, conn });
    });
    await notifyProcessEvent('PROCESS_WITHDRAWN', process, { actor, notes: reason });
    return getProcess(actor, id);
  }

  if (!POST_AUTHORIZATION.includes(process.status)) {
    throw conflict('Este processo já não pode ser cancelado', 'NOT_CANCELLABLE');
  }
  await assertNotEarlyRelease(id);
  if (await queryOne("SELECT id FROM cancellation_requests WHERE process_id = ? AND status = 'PENDENTE'", [id])) {
    throw conflict('Já existe um pedido de cancelamento pendente', 'ALREADY_REQUESTED');
  }
  await withTransaction(async (conn) => {
    await conn.query('INSERT INTO cancellation_requests (process_id, requested_by, reason) VALUES (?, ?, ?)', [id, actor.id, reason]);
    await audit(actor, 'CANCELLATION_REQUESTED', 'process', id, { entityId: process.entityId, details: { reason }, conn });
  });
  await notifyProcessEvent('CANCELLATION_REQUESTED', process, { actor, notes: reason });
  return getProcess(actor, id);
}

/** Sogester decide o pedido: aprovar cancela o processo; recusar exige motivo e deixa tudo como estava. */
export async function decideCancellation(actor, id, { approve, notes }) {
  const process = await loadAccessible(actor, id);
  const request = await queryOne("SELECT id FROM cancellation_requests WHERE process_id = ? AND status = 'PENDENTE'", [id]);
  if (!request) throw conflict('Não há pedido de cancelamento pendente', 'NO_PENDING_REQUEST');

  if (approve) {
    if (process.status === 'PAGAMENTO_SUBMETIDO') {
      throw conflict('Há um comprovativo por validar: confirme ou recuse o pagamento antes de cancelar', 'PAYMENT_UNDER_REVIEW');
    }
    if (!POST_AUTHORIZATION.includes(process.status)) throw conflict('Este processo já não pode ser cancelado', 'NOT_CANCELLABLE');
    await assertNotEarlyRelease(id);
  } else if (!notes) {
    throw badRequest('Indique o motivo da recusa', 'NOTES_REQUIRED');
  }

  await withTransaction(async (conn) => {
    await conn.query('UPDATE cancellation_requests SET status = ?, decided_by = ?, decided_at = NOW(), decision_notes = ? WHERE id = ?', [
      approve ? 'APROVADO' : 'RECUSADO',
      actor.id,
      notes ?? null,
      request.id,
    ]);
    if (approve) await closeProcess(conn, actor, process, notes ?? 'Cancelamento aprovado');
    await audit(actor, approve ? 'CANCELLATION_APPROVED' : 'CANCELLATION_DENIED', 'process', id, {
      entityId: process.entityId,
      details: { notes },
      conn,
    });
  });
  await notifyProcessEvent(approve ? 'CANCELLATION_APPROVED' : 'CANCELLATION_DENIED', process, { actor, notes });
  return getProcess(actor, id);
}

/** Exceção do administrador: cancela por iniciativa da Sogester (antes de confirmar o pagamento). */
export async function staffCancel(actor, id, { reason }) {
  const process = await loadAccessible(actor, id);
  if (process.status === 'PAGAMENTO_SUBMETIDO') {
    throw conflict('Há um comprovativo por validar: confirme ou recuse o pagamento antes de cancelar', 'PAYMENT_UNDER_REVIEW');
  }
  if (![...PRE_AUTHORIZATION, ...POST_AUTHORIZATION].includes(process.status)) {
    throw conflict('Este processo já não pode ser cancelado', 'NOT_CANCELLABLE');
  }
  await assertNotEarlyRelease(id);

  await withTransaction(async (conn) => {
    await conn.query(
      "UPDATE cancellation_requests SET status = 'APROVADO', decided_by = ?, decided_at = NOW(), decision_notes = ? WHERE process_id = ? AND status = 'PENDENTE'",
      [actor.id, reason, id],
    );
    await closeProcess(conn, actor, process, reason);
    await audit(actor, 'PROCESS_CANCELLED', 'process', id, { entityId: process.entityId, details: { reason }, conn });
  });
  await notifyProcessEvent('PROCESS_CANCELLED', process, { actor, notes: reason });
  return getProcess(actor, id);
}

// ---- exceções do administrador --------------------------------------------------------------
/** Revoga uma autorização ainda sem proforma: o código deixa de ser válido e o processo volta à análise. */
export async function revokeAuthorization(actor, id, { reason }) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'AUTORIZACAO_EMITIDA') {
    throw conflict('Só se revoga a autorização antes de emitir a proforma', 'INVALID_TRANSITION');
  }
  const auth = await activeAuthorization(id);
  if (!auth) throw conflict('Não há autorização ativa', 'NO_AUTHORIZATION');
  await assertNotEarlyRelease(id);

  await withTransaction(async (conn) => {
    await conn.query('UPDATE authorizations SET revoked_at = NOW(), revoked_by = ?, revoke_reason = ? WHERE id = ?', [actor.id, reason, auth.id]);
    await changeStatus(actor, process, 'EM_ANALISE', `Autorização revogada: ${reason}`, conn);
    await audit(actor, 'AUTHORIZATION_REVOKED', 'process', id, { entityId: process.entityId, details: { reason }, conn });
  });
  await notifyProcessEvent('AUTHORIZATION_REVOKED', process, { actor, notes: reason });
  return getProcess(actor, id);
}

/** Prorroga o prazo de pagamento do compromisso (limitado e justificado); os alertas voltam a disparar. */
export async function extendDeadline(actor, id, { days, reason }) {
  const process = await loadAccessible(actor, id);
  if (PAID.includes(process.status) || process.status === 'CANCELADO') {
    throw conflict('O pagamento deste processo já não está em aberto', 'NOT_OPEN');
  }
  const c = await queryOne('SELECT id, due_at AS dueAt, extension_count AS count FROM payment_commitments WHERE process_id = ?', [id]);
  if (!c?.dueAt) throw conflict('Este processo não tem prazo de pagamento a prorrogar', 'NO_DEADLINE');
  if (c.count >= MAX_EXTENSIONS) throw conflict(`Limite de ${MAX_EXTENSIONS} prorrogações atingido`, 'EXTENSION_LIMIT');

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO commitment_extensions (commitment_id, extended_by, days, reason, previous_due_at, new_due_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(GREATEST(?, NOW()), INTERVAL ? DAY))`,
      [c.id, actor.id, days, reason, c.dueAt, c.dueAt, days],
    );
    await conn.query(
      `UPDATE payment_commitments
          SET due_at = DATE_ADD(GREATEST(due_at, NOW()), INTERVAL ? DAY), extension_count = extension_count + 1,
              reminder_sent_at = NULL, overdue_notified_at = NULL
        WHERE id = ?`,
      [days, c.id],
    );
    await audit(actor, 'DEADLINE_EXTENDED', 'process', id, { entityId: process.entityId, details: { days, reason }, conn });
  });
  await notifyProcessEvent('DEADLINE_EXTENDED', process, { actor, notes: `${days} dia(s): ${reason}` });
  return getProcess(actor, id);
}

/** Reabre um processo rejeitado (antes de qualquer autorização) devolvendo-o à análise. */
export async function reopenProcess(actor, id, { reason }) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'REJEITADO') throw conflict('Só processos rejeitados podem ser reabertos', 'INVALID_TRANSITION');
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'EM_ANALISE', `Reaberto: ${reason}`, conn);
    await audit(actor, 'PROCESS_REOPENED', 'process', id, { entityId: process.entityId, details: { reason }, conn });
  });
  await notifyProcessEvent('PROCESS_REOPENED', process, { actor, notes: reason });
  return getProcess(actor, id);
}

