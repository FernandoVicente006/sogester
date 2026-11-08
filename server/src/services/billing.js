import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { ROLES, isForwarder, isSuperAdmin } from '../roles.js';
import { audit } from './audit.js';
import { notifyProcessEvent } from './notifications.js';
import { changeStatus, getProcess, insertDocument, loadAccessible } from './processes.js';

// Texto a rever pelo jurídico da Sogester antes de produção.
export const COMMITMENT_TERMS_VERSION = '2.0';
const commitmentTerms = (p, reason) =>
  `Eu, em nome do transitário ${p.forwarderName}, aceito a saída antecipada da carga do processo ${p.reference}, ` +
  `autorizada pela Sogester (${p.entityCode}) pelo motivo: «${reason}». Comprometo-me a liquidar integralmente os ` +
  `emolumentos do processo, mediante a proforma que me for apresentada, até à data limite que a Sogester fixar. ` +
  `Reconheço que a carga sai antes do pagamento exclusivamente com base neste compromisso e que, em caso de ` +
  `incumprimento, a Sogester pode aplicar multa e recorrer às vias legais.`;

/** Só antes da proforma: depois dela o pagamento já está em curso e a carga sai pelo fluxo normal. */
const AUTHORIZABLE = ['EM_ANALISE', 'DOCUMENTOS_SUBMETIDOS', 'EM_PROCESSAMENTO_INTERNO'];

// ---- código de autorização verificável ----------------------------------------------------
function authorizationCode({ processId, reference, type, issuedAt, commitmentSignature, seq = 1 }) {
  const mac = crypto
    .createHmac('sha256', config.authorizationSecret)
    // `seq` só entra a partir da 2.ª autorização do processo (após revogação), mantendo válidos os códigos antigos.
    .update([processId, reference, type, issuedAt.toISOString(), commitmentSignature ?? '', ...(seq > 1 ? [seq] : [])].join('|'))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `AUT-${mac.slice(0, 4)}-${mac.slice(4, 8)}-${mac.slice(8, 12)}`;
}

const activeAuthorization = (processId) =>
  queryOne(
    'SELECT id, reason, commitment_id AS commitmentId, used_at AS usedAt FROM authorizations WHERE process_id = ? AND revoked_at IS NULL',
    [processId],
  );

// ---- saída antecipada ----------------------------------------------------------------------
/**
 * Exceção para problemas da Sogester que impedem a saída da carga: o chefe comercial ou o administrador emite-a
 * com o motivo e a validade. Não muda o estado do processo; só fica utilizável depois do aceite do transitário.
 */
export async function issueAuthorization(actor, id, { reason, validDays }) {
  const process = await loadAccessible(actor, id);
  if (!AUTHORIZABLE.includes(process.status)) {
    throw conflict('A saída antecipada só pode ser emitida antes da proforma', 'INVALID_TRANSITION');
  }
  if (await activeAuthorization(id)) throw conflict('Este processo já tem uma saída antecipada ativa', 'ALREADY_AUTHORIZED');

  const type = 'SAIDA_ANTECIPADA';
  const issuedAt = new Date();
  issuedAt.setMilliseconds(0);
  const validUntil = new Date(issuedAt.getTime() + validDays * 86400000);
  const { n: previous } = await queryOne('SELECT COUNT(*) AS n FROM authorizations WHERE process_id = ?', [id]);
  const seq = Number(previous) + 1;
  const code = authorizationCode({ processId: id, reference: process.reference, type, issuedAt, seq });

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO authorizations (process_id, type, code, issued_by, issued_at, reason, valid_until, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, type, code, actor.id, issuedAt, reason, validUntil, seq],
    );
    await audit(actor, 'AUTHORIZATION_ISSUED', 'process', id, { entityId: process.entityId, details: { type, code, reason, validDays }, conn });
  });
  await notifyProcessEvent('AUTHORIZATION_ISSUED', process, { actor, notes: reason });
  return getProcess(actor, id);
}

/** O transitário aceita o compromisso com a palavra-passe; só depois a autorização pode ser impressa e usada. */
export async function signCommitment(actor, id, { password, accept }, ip) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  const auth = await activeAuthorization(id);
  if (!auth || auth.commitmentId) throw conflict('Não há saída antecipada a aguardar o seu aceite', 'NO_PENDING_AUTHORIZATION');
  if (!AUTHORIZABLE.includes(process.status)) throw conflict('O compromisso já não pode ser aceite neste estado', 'INVALID_STATE');
  if (!accept) throw badRequest('É necessário aceitar os termos', 'TERMS_NOT_ACCEPTED');

  const user = await queryOne('SELECT password_hash FROM users WHERE id = ?', [actor.id]);
  if (!(await bcrypt.compare(password, user.password_hash))) throw badRequest('Palavra-passe incorreta', 'WRONG_PASSWORD');

  // Salvaguarda de receita: quem está em incumprimento não aceita novas saídas antecipadas.
  const overdue = await queryOne(
    `SELECT COUNT(*) AS n FROM payment_commitments c JOIN processes p ON p.id = c.process_id
      WHERE p.forwarder_id = ? AND c.due_at < NOW() AND p.status NOT IN ('PAGAMENTO_CONFIRMADO', 'CONCLUIDO', 'CANCELADO')`,
    [actor.forwarderId],
  );
  if (overdue.n) throw conflict('Existem processos em incumprimento; liquide-os antes de aceitar novos compromissos', 'OVERDUE_COMMITMENTS');

  const termsText = commitmentTerms(process, auth.reason);
  const signedAt = new Date();
  const signatureHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ processId: id, userId: actor.id, termsText, signedAt: signedAt.toISOString() }))
    .digest('hex');

  await withTransaction(async (conn) => {
    // Um compromisso por processo: se houve uma autorização anterior revogada, o novo aceite substitui o antigo.
    await conn.query(
      `INSERT INTO payment_commitments (process_id, signed_by, terms_version, terms_text, signature_hash, ip, signed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE signed_by = new.signed_by, terms_version = new.terms_version, terms_text = new.terms_text,
         signature_hash = new.signature_hash, ip = new.ip, signed_at = new.signed_at, due_at = NULL,
         reminder_sent_at = NULL, overdue_notified_at = NULL, id = LAST_INSERT_ID(payment_commitments.id)`,
      [id, actor.id, COMMITMENT_TERMS_VERSION, termsText, signatureHash, ip ?? null, signedAt],
    );
    await conn.query('UPDATE authorizations SET commitment_id = LAST_INSERT_ID() WHERE id = ?', [auth.id]);
    await audit(actor, 'PAYMENT_COMMITMENT_SIGNED', 'process', id, { entityId: process.entityId, conn });
  });
  await notifyProcessEvent('COMMITMENT_SIGNED', process, { actor });
  return getProcess(actor, id);
}

export async function getCommitmentTerms(actor, id) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  const auth = await activeAuthorization(id);
  if (!auth || auth.commitmentId) throw conflict('Não há saída antecipada a aguardar o seu aceite', 'NO_PENDING_AUTHORIZATION');
  return { version: COMMITMENT_TERMS_VERSION, text: commitmentTerms(process, auth.reason) };
}

async function findAuthorization(code) {
  const row = await queryOne(
    `SELECT a.id, a.process_id AS processId, a.type, a.issued_at AS issuedAt, a.seq, a.revoked_at AS revokedAt,
            a.commitment_id AS commitmentId, a.valid_until AS validUntil, a.used_at AS usedAt,
            a.code_includes_commitment AS includesCommitment, p.reference, p.status, p.entity_id AS entityId,
            f.name AS forwarderName, e.name AS entityName, pc.signature_hash AS commitmentSignature
       FROM authorizations a
       JOIN processes p ON p.id = a.process_id
       JOIN forwarders f ON f.id = p.forwarder_id
       JOIN entities e ON e.id = p.entity_id
       LEFT JOIN payment_commitments pc ON pc.id = a.commitment_id
      WHERE a.code = ?`,
    [code],
  );
  if (!row) return null;
  const expected = authorizationCode({
    ...row,
    issuedAt: new Date(row.issuedAt),
    commitmentSignature: row.includesCommitment ? row.commitmentSignature : '',
  });
  return expected === code ? row : null;
}

/** Estado da autorização para quem a apresenta na portaria. */
function authorizationState(row) {
  if (row.revokedAt) return 'REVOGADA';
  if (!row.commitmentId) return 'AGUARDA_ACEITE';
  if (row.usedAt) return 'USADA';
  if (row.validUntil && new Date(row.validUntil) < new Date()) return 'EXPIRADA';
  return 'VALIDA';
}

/** Verificação pública do código (QR Code): confirma autenticidade e estado sem expor dados do cliente. */
export async function verifyAuthorization(code) {
  const row = await findAuthorization(code);
  if (!row) return { valid: false, state: 'INVALIDA' };
  const state = authorizationState(row);
  return {
    valid: state === 'VALIDA',
    state,
    revoked: state === 'REVOGADA' || undefined,
    reference: row.reference,
    type: row.type,
    issuedAt: row.issuedAt,
    validUntil: row.validUntil,
    usedAt: row.usedAt,
    entity: row.entityName,
    forwarder: row.forwarderName,
    paymentSettled: ['PAGAMENTO_CONFIRMADO', 'CONCLUIDO'].includes(row.status),
    cancelled: row.status === 'CANCELADO',
  };
}

const GATE_ROLES = [ROLES.PORTARIA, ROLES.ADMIN_ENTIDADE, ROLES.SUPER_ADMIN];

async function gateAuthorization(actor, code) {
  if (!GATE_ROLES.includes(actor.role)) throw forbidden();
  const row = await findAuthorization(code);
  // A portaria só vê autorizações do seu terminal.
  if (!row || (!isSuperAdmin(actor) && row.entityId !== actor.entityId)) throw notFound('Autorização não encontrada');
  return row;
}

/** Portaria: dados da carga para conferir à saída (B/L, DU, navio, veículos e contentores). */
export async function gateDetails(actor, code) {
  const row = await gateAuthorization(actor, code);
  // O alcance já foi validado acima (mesmo terminal); lê o processo sem o filtro de perfil.
  const process = await getProcess({ ...actor, role: ROLES.SUPER_ADMIN }, row.processId);
  return {
    ...(await verifyAuthorization(code)),
    cargo: {
      client: process.client.name,
      blNumber: process.blNumber,
      duNumber: process.duNumber,
      vessel: process.vesselName ? `${process.vesselName} · ${process.voyageNumber}` : null,
      vehicles: process.vehicles.map((v) => ({ chassis: v.chassis, name: `${v.brand} ${v.model}` })),
      containers: process.containers.map((c) => ({ number: c.number, size: c.size })),
      goods: process.goods.map((g) => `${g.quantity} ${g.unit} · ${g.description}`),
    },
  };
}

/** Portaria: regista a saída; a autorização vale para uma única saída. */
export async function useAuthorization(actor, code) {
  const row = await gateAuthorization(actor, code);
  const state = authorizationState(row);
  if (state !== 'VALIDA') throw conflict(`Autorização ${state.toLowerCase().replace('_', ' ')}`, `AUTHORIZATION_${state}`);
  await withTransaction(async (conn) => {
    const [res] = await conn.query('UPDATE authorizations SET used_at = NOW(), used_by = ? WHERE id = ? AND used_at IS NULL', [actor.id, row.id]);
    if (!res.affectedRows) throw conflict('Autorização usada', 'AUTHORIZATION_USADA');
    await audit(actor, 'AUTHORIZATION_USED', 'process', row.processId, { entityId: row.entityId, details: { code }, conn });
  });
  const process = await queryOne(
    `SELECT p.id, p.reference, p.entity_id AS entityId, p.forwarder_id AS forwarderId, f.name AS forwarderName
       FROM processes p JOIN forwarders f ON f.id = p.forwarder_id WHERE p.id = ?`,
    [row.processId],
  );
  await notifyProcessEvent('AUTHORIZATION_USED', process, { actor });
  return gateDetails(actor, code);
}

// ---- proforma, comprovativo, confirmação e fatura recibo ------------------------------------
/** A Loja carrega a proforma gerada no sistema de faturação da Sogester; só o ficheiro é obrigatório. */
export async function issueProforma(actor, id, data, file) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'EM_PROCESSAMENTO_INTERNO') {
    throw conflict('A proforma só pode ser carregada depois de os documentos estarem conformes', 'INVALID_TRANSITION');
  }
  // Com saída antecipada, a Sogester fixa aqui a data limite de pagamento do compromisso.
  const auth = await activeAuthorization(id);
  if (auth && !auth.commitmentId) {
    throw conflict('A saída antecipada aguarda o aceite do transitário: aguarde ou revogue-a antes da proforma', 'AUTHORIZATION_AWAITING_ACCEPTANCE');
  }
  if (auth && !data.dueDate) throw badRequest('Indique a data limite de pagamento da saída antecipada', 'DUE_DATE_REQUIRED');
  await withTransaction(async (conn) => {
    if (auth) {
      await conn.query(
        `UPDATE payment_commitments SET due_at = TIMESTAMP(?, '23:59:59'), reminder_sent_at = NULL, overdue_notified_at = NULL
          WHERE id = ?`,
        [data.dueDate, auth.commitmentId],
      );
    }
    await changeStatus(actor, process, 'PAGAMENTO_PENDENTE', null, conn);
    await conn.query(
      `INSERT INTO invoices (process_id, proforma_number, amount, currency, payment_entity, payment_reference, proforma_issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.number ?? null, data.amount ?? null, data.currency ?? 'AOA', data.paymentEntity ?? null, data.paymentReference ?? null, actor.id],
    );
    await insertDocument(conn, id, 'PROFORMA', file, actor.id);
    await audit(actor, 'PROFORMA_ISSUED', 'process', id, { entityId: process.entityId, details: { number: data.number }, conn });
  });
  await notifyProcessEvent('PROFORMA_ISSUED', process, { actor, notes: auth ? `Data limite de pagamento: ${data.dueDate.split('-').reverse().join('/')}` : null });
  return getProcess(actor, id);
}

export async function submitPaymentProof(actor, id, file) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  if (process.status !== 'PAGAMENTO_PENDENTE') {
    throw conflict('Não há pagamento pendente neste processo', 'INVALID_TRANSITION');
  }
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'PAGAMENTO_SUBMETIDO', null, conn);
    await conn.query('UPDATE invoices SET proof_submitted_at = NOW() WHERE process_id = ?', [id]);
    await insertDocument(conn, id, 'COMPROVATIVO', file, actor.id);
    await audit(actor, 'PAYMENT_PROOF_SUBMITTED', 'process', id, { entityId: process.entityId, conn });
  });
  await notifyProcessEvent('PAYMENT_PROOF_SUBMITTED', process, { actor });
  return getProcess(actor, id);
}

export async function confirmPayment(actor, id, { notes } = {}) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'PAGAMENTO_SUBMETIDO') throw conflict('Não há comprovativo para validar', 'INVALID_TRANSITION');
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'PAGAMENTO_CONFIRMADO', notes, conn);
    await conn.query('UPDATE invoices SET payment_confirmed_by = ?, payment_confirmed_at = NOW() WHERE process_id = ?', [actor.id, id]);
    await audit(actor, 'PAYMENT_CONFIRMED', 'process', id, { entityId: process.entityId, conn });
  });
  await notifyProcessEvent('PAYMENT_CONFIRMED', process, { actor });
  return getProcess(actor, id);
}

/** Comprovativo inválido: volta a PAGAMENTO_PENDENTE para o transitário submeter outro. */
export async function rejectPayment(actor, id, { notes }) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'PAGAMENTO_SUBMETIDO') throw conflict('Não há comprovativo para validar', 'INVALID_TRANSITION');
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'PAGAMENTO_PENDENTE', notes, conn);
    await conn.query('UPDATE invoices SET proof_submitted_at = NULL WHERE process_id = ?', [id]);
    await audit(actor, 'PAYMENT_PROOF_REJECTED', 'process', id, { entityId: process.entityId, details: { notes }, conn });
  });
  await notifyProcessEvent('PAYMENT_PROOF_REJECTED', process, { actor, notes });
  return getProcess(actor, id);
}

/** As Finanças carregam a fatura recibo gerada no sistema de faturação; o processo conclui-se sozinho. */
export async function issueReceipt(actor, id, { number }, file) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'PAGAMENTO_CONFIRMADO') {
    throw conflict('A fatura recibo só pode ser emitida depois de confirmar o pagamento', 'INVALID_TRANSITION');
  }
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'CONCLUIDO', null, conn);
    await conn.query(
      'UPDATE invoices SET receipt_number = ?, receipt_issued_by = ?, receipt_issued_at = NOW() WHERE process_id = ?',
      [number ?? null, actor.id, id],
    );
    await insertDocument(conn, id, 'FATURA_RECIBO', file, actor.id);
    await audit(actor, 'RECEIPT_ISSUED', 'process', id, { entityId: process.entityId, details: { number }, conn });
  });
  await notifyProcessEvent('PROCESS_COMPLETED', process, { actor });
  return getProcess(actor, id);
}

