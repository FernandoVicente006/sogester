import { queryOne, withTransaction } from '../db/pool.js';
import { conflict, forbidden } from '../errors.js';
import { isForwarder } from '../roles.js';
import { audit } from './audit.js';
import { notifyProcessEvent } from './notifications.js';
import { MAX_EXTENSIONS, changeStatus, getProcess, loadAccessible } from './processes.js';

/** Só se cancela até os documentos estarem conformes; depois da aprovação documental o processo segue até ao fim. */
const BEFORE_APPROVAL = ['SUBMETIDO', 'EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'DOCUMENTOS_SUBMETIDOS'];
const AFTER_APPROVAL = ['EM_PROCESSAMENTO_INTERNO', 'PAGAMENTO_PENDENTE', 'PAGAMENTO_SUBMETIDO'];
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

// ---- cancelamento -------------------------------------------------------------------------
async function assertCancellable(process) {
  if (!BEFORE_APPROVAL.includes(process.status)) {
    throw conflict('Depois da aprovação documental o processo já não pode ser cancelado', 'NOT_CANCELLABLE');
  }
  await assertNotEarlyRelease(process.id);
}

/** Transitário: desiste do processo enquanto os documentos estão em análise. */
export async function withdrawProcess(actor, id, { reason }) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  await assertCancellable(process);
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'CANCELADO', reason, conn);
    await audit(actor, 'PROCESS_WITHDRAWN', 'process', id, { entityId: process.entityId, details: { reason }, conn });
  });
  await notifyProcessEvent('PROCESS_WITHDRAWN', process, { actor, notes: reason });
  return getProcess(actor, id);
}

/** Administrador: cancela por iniciativa da Sogester, nas mesmas condições. */
export async function staffCancel(actor, id, { reason }) {
  const process = await loadAccessible(actor, id);
  await assertCancellable(process);
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'CANCELADO', reason, conn);
    await audit(actor, 'PROCESS_CANCELLED', 'process', id, { entityId: process.entityId, details: { reason }, conn });
  });
  await notifyProcessEvent('PROCESS_CANCELLED', process, { actor, notes: reason });
  return getProcess(actor, id);
}

// ---- exceções do administrador --------------------------------------------------------------
/** Revoga a saída antecipada: o código deixa de ser válido, o prazo cai e o processo segue o fluxo normal. */
export async function revokeAuthorization(actor, id, { reason }) {
  const process = await loadAccessible(actor, id);
  if (![...BEFORE_APPROVAL, ...AFTER_APPROVAL].includes(process.status)) {
    throw conflict('Já não é possível revogar a autorização deste processo', 'INVALID_TRANSITION');
  }
  const auth = await activeAuthorization(id);
  if (!auth) throw conflict('Não há autorização ativa', 'NO_AUTHORIZATION');

  await withTransaction(async (conn) => {
    await conn.query('UPDATE authorizations SET revoked_at = NOW(), revoked_by = ?, revoke_reason = ? WHERE id = ?', [actor.id, reason, auth.id]);
    await conn.query('UPDATE payment_commitments SET due_at = NULL, reminder_sent_at = NULL, overdue_notified_at = NULL WHERE process_id = ?', [id]);
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

