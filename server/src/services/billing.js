import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { isForwarder } from '../roles.js';
import { audit } from './audit.js';
import { notifyProcessEvent } from './notifications.js';
import { changeStatus, getProcess, insertDocument, loadAccessible } from './processes.js';

export const COMMITMENT_TERMS_VERSION = '1.0';
const commitmentTerms = (p) =>
  `Eu, em nome do transitário ${p.forwarderName}, comprometo-me a liquidar integralmente à Sogester (${p.entityCode}) ` +
  `os emolumentos do processo ${p.reference}, no prazo de ${config.commitmentDays} dias após a emissão da autorização de saída, ` +
  `mediante a proforma que me for apresentada. Reconheço que a carga é libertada antes da confirmação do pagamento ` +
  `exclusivamente com base neste compromisso e que o incumprimento suspende novos compromissos deste género.`;

const PRE_AUTHORIZATION = ['SUBMETIDO', 'EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'DOCUMENTOS_SUBMETIDOS'];
const AUTHORIZABLE = ['EM_ANALISE', 'DOCUMENTOS_SUBMETIDOS'];

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

// ---- compromisso de pagamento (cargas perecíveis) ------------------------------------------
/** O transitário assina o compromisso com a palavra-passe; é a garantia da Sogester para a saída antecipada. */
export async function signCommitment(actor, id, { password, accept }, ip) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  if (process.cargoPriority !== 'PERECIVEL') throw conflict('Só cargas perecíveis usam compromisso de pagamento', 'NOT_PERISHABLE');
  if (!PRE_AUTHORIZATION.includes(process.status)) throw conflict('O compromisso já não pode ser assinado neste estado', 'INVALID_STATE');
  if (!accept) throw badRequest('É necessário aceitar os termos', 'TERMS_NOT_ACCEPTED');

  const user = await queryOne('SELECT password_hash FROM users WHERE id = ?', [actor.id]);
  if (!(await bcrypt.compare(password, user.password_hash))) throw badRequest('Palavra-passe incorreta', 'WRONG_PASSWORD');

  // Salvaguarda de receita: quem tem compromissos em atraso não assina novos.
  const overdue = await queryOne(
    `SELECT COUNT(*) AS n FROM payment_commitments c JOIN processes p ON p.id = c.process_id
      WHERE p.forwarder_id = ? AND c.due_at < NOW() AND p.status NOT IN ('PAGAMENTO_CONFIRMADO', 'CONCLUIDO', 'CANCELADO')`,
    [actor.forwarderId],
  );
  if (overdue.n) throw conflict('Existem compromissos em atraso; liquide-os antes de assinar novos', 'OVERDUE_COMMITMENTS');
  if (await queryOne('SELECT id FROM payment_commitments WHERE process_id = ?', [id])) {
    throw conflict('Compromisso já assinado', 'ALREADY_SIGNED');
  }

  const termsText = commitmentTerms(process);
  const signedAt = new Date();
  const signatureHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ processId: id, userId: actor.id, termsText, signedAt: signedAt.toISOString() }))
    .digest('hex');

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO payment_commitments (process_id, signed_by, terms_version, terms_text, signature_hash, ip, signed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, actor.id, COMMITMENT_TERMS_VERSION, termsText, signatureHash, ip ?? null, signedAt],
    );
    await audit(actor, 'PAYMENT_COMMITMENT_SIGNED', 'process', id, { entityId: process.entityId, conn });
  });
  await notifyProcessEvent('COMMITMENT_SIGNED', process, { actor });
  return getProcess(actor, id);
}

export async function getCommitmentTerms(actor, id) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  return { version: COMMITMENT_TERMS_VERSION, text: commitmentTerms(process) };
}

// ---- autorização digital -------------------------------------------------------------------
/** A Sogester emite o termo. Cargas perecíveis exigem compromisso assinado e ficam com saída antecipada. */
export async function issueAuthorization(actor, id, { notes } = {}) {
  const process = await loadAccessible(actor, id);
  if (!AUTHORIZABLE.includes(process.status)) {
    throw conflict('A autorização só pode ser emitida após a análise da documentação', 'INVALID_TRANSITION');
  }
  const perishable = process.cargoPriority === 'PERECIVEL';
  const commitment = await queryOne('SELECT id, signature_hash AS signature FROM payment_commitments WHERE process_id = ?', [id]);
  if (perishable && !commitment) {
    throw conflict('Carga perecível: o transitário tem de assinar o compromisso de pagamento primeiro', 'COMMITMENT_REQUIRED');
  }

  const type = perishable ? 'SAIDA_ANTECIPADA' : 'PADRAO';
  const issuedAt = new Date();
  issuedAt.setMilliseconds(0);
  const { n: previous } = await queryOne('SELECT COUNT(*) AS n FROM authorizations WHERE process_id = ?', [id]);
  const seq = Number(previous) + 1;
  const code = authorizationCode({
    processId: id,
    reference: process.reference,
    type,
    issuedAt,
    commitmentSignature: commitment?.signature,
    seq,
  });

  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'AUTORIZACAO_EMITIDA', notes, conn);
    await conn.query(
      'INSERT INTO authorizations (process_id, type, code, commitment_id, issued_by, issued_at, notes, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, type, code, commitment?.id ?? null, actor.id, issuedAt, notes ?? null, seq],
    );
    if (commitment) {
      await conn.query('UPDATE payment_commitments SET due_at = DATE_ADD(?, INTERVAL ? DAY) WHERE id = ?', [
        issuedAt,
        config.commitmentDays,
        commitment.id,
      ]);
    }
    await audit(actor, 'AUTHORIZATION_ISSUED', 'process', id, { entityId: process.entityId, details: { type, code }, conn });
  });
  await notifyProcessEvent('AUTHORIZATION_ISSUED', process, { actor });
  return getProcess(actor, id);
}

/** Verificação pública do código (para o porto/terceiros): confirma autenticidade sem expor dados do cliente. */
export async function verifyAuthorization(code) {
  const row = await queryOne(
    `SELECT a.process_id AS processId, a.type, a.issued_at AS issuedAt, a.seq, a.revoked_at AS revokedAt, p.reference, p.status,
            f.name AS forwarderName, e.name AS entityName, pc.signature_hash AS commitmentSignature
       FROM authorizations a
       JOIN processes p ON p.id = a.process_id
       JOIN forwarders f ON f.id = p.forwarder_id
       JOIN entities e ON e.id = p.entity_id
       LEFT JOIN payment_commitments pc ON pc.id = a.commitment_id
      WHERE a.code = ?`,
    [code],
  );
  if (!row) return { valid: false };
  const expected = authorizationCode({ ...row, issuedAt: new Date(row.issuedAt) });
  if (expected !== code) return { valid: false };
  if (row.revokedAt) return { valid: false, revoked: true, reference: row.reference };
  return {
    valid: true,
    reference: row.reference,
    type: row.type,
    issuedAt: row.issuedAt,
    entity: row.entityName,
    forwarder: row.forwarderName,
    paymentSettled: ['PAGAMENTO_CONFIRMADO', 'CONCLUIDO'].includes(row.status),
    cancelled: row.status === 'CANCELADO',
  };
}

// ---- proforma, comprovativo, confirmação e fatura recibo ------------------------------------
export async function issueProforma(actor, id, data, file) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'AUTORIZACAO_EMITIDA') {
    throw conflict('A proforma só pode ser emitida depois da autorização', 'INVALID_TRANSITION');
  }
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'PAGAMENTO_PENDENTE', null, conn);
    await conn.query(
      `INSERT INTO invoices (process_id, proforma_number, amount, currency, payment_entity, payment_reference, proforma_issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.number, data.amount, data.currency ?? 'AOA', data.paymentEntity, data.paymentReference, actor.id],
    );
    await insertDocument(conn, id, 'PROFORMA', file, actor.id);
    await audit(actor, 'PROFORMA_ISSUED', 'process', id, { entityId: process.entityId, details: { number: data.number }, conn });
  });
  await notifyProcessEvent('PROFORMA_ISSUED', process, { actor });
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

export async function issueReceipt(actor, id, { number }, file) {
  const process = await loadAccessible(actor, id);
  if (process.status !== 'PAGAMENTO_CONFIRMADO') {
    throw conflict('A fatura recibo só pode ser emitida depois de confirmar o pagamento', 'INVALID_TRANSITION');
  }
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, 'CONCLUIDO', null, conn);
    await conn.query(
      'UPDATE invoices SET receipt_number = ?, receipt_issued_by = ?, receipt_issued_at = NOW() WHERE process_id = ?',
      [number, actor.id, id],
    );
    await insertDocument(conn, id, 'FATURA_RECIBO', file, actor.id);
    await audit(actor, 'RECEIPT_ISSUED', 'process', id, { entityId: process.entityId, details: { number }, conn });
  });
  await notifyProcessEvent('PROCESS_COMPLETED', process, { actor });
  return getProcess(actor, id);
}

