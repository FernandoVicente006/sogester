import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { CARGO_PRIORITIES, VOLUME_TYPES, isVehicleCategory } from '../cargo.js';
import { isForwarder, isSuperAdmin } from '../roles.js';
import { audit } from './audit.js';
import { isApprovedIn } from './forwarders.js';

export const documentsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/documents');

/**
 * Transições de estado atualmente expostas. A partir de AUTORIZACAO_EMITIDA (autorização digital e
 * faturação) pertence ao módulo 6 e será acrescentada ao mesmo mapa.
 */
export const STAFF_TRANSITIONS = {
  SUBMETIDO: ['EM_ANALISE', 'REJEITADO'],
  EM_ANALISE: ['DOCUMENTOS_PENDENTES', 'REJEITADO'],
  DOCUMENTOS_SUBMETIDOS: ['EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'REJEITADO'],
};
const NOTES_REQUIRED = ['DOCUMENTOS_PENDENTES', 'REJEITADO'];

const SELECT = `
  SELECT p.id, p.reference, p.entity_id AS entityId, e.code AS entityCode, p.forwarder_id AS forwarderId,
         f.name AS forwarderName, p.status, p.status_notes AS statusNotes,
         p.cargo_priority AS cargoPriority, p.priority_rank AS priorityRank,
         p.urgency_requested AS urgencyRequested, p.urgency_reason AS urgencyReason,
         p.volume_type AS volumeType, p.cargo_category AS cargoCategory, p.description,
         p.quantity, p.weight_kg AS weightKg, p.vehicle_brand AS vehicleBrand, p.vehicle_model AS vehicleModel,
         p.container_plate AS containerPlate, p.container_type AS containerType,
         p.container_volume AS containerVolume, p.container_weight_kg AS containerWeightKg,
         p.submitted_at AS submittedAt, p.updated_at AS updatedAt,
         c.id AS clientId, c.type AS clientType, c.name AS clientName, c.document_number AS clientDocument,
         c.is_foreign AS clientIsForeign
    FROM processes p
    JOIN entities e ON e.id = p.entity_id
    JOIN forwarders f ON f.id = p.forwarder_id
    JOIN clients c ON c.id = p.client_id`;

const num = (v) => (v === null || v === undefined ? null : Number(v));

function mapProcess(r) {
  const { clientId, clientType, clientName, clientDocument, clientIsForeign, ...p } = r;
  return {
    ...p,
    urgencyRequested: !!p.urgencyRequested,
    quantity: num(p.quantity),
    weightKg: num(p.weightKg),
    containerVolume: num(p.containerVolume),
    containerWeightKg: num(p.containerWeightKg),
    client: { id: clientId, type: clientType, name: clientName, documentNumber: clientDocument, isForeign: !!clientIsForeign },
  };
}

/** Condição SQL que limita os processos visíveis ao ator. */
function scopeClause(actor) {
  if (isForwarder(actor)) return { sql: 'p.forwarder_id = ?', params: [actor.forwarderId] };
  if (isSuperAdmin(actor)) return { sql: '1 = 1', params: [] };
  return { sql: 'p.entity_id = ?', params: [actor.entityId] };
}

async function loadAccessible(actor, id) {
  const scope = scopeClause(actor);
  const row = await queryOne(`${SELECT} WHERE p.id = ? AND ${scope.sql}`, [id, ...scope.params]);
  if (!row) throw notFound('Processo não encontrado');
  return row;
}

// ---- validação de regras de negócio --------------------------------------------------------
function validateCargo(input) {
  const errors = [];
  const need = (field, ok, message) => !ok && errors.push({ field, message });
  const volume = VOLUME_TYPES[input.volumeType];

  if (input.volumeType === 'CONTENTOR') {
    const c = input.container;
    need('container', !!c, 'Dados do contentor obrigatórios');
    if (input.cargoCategory) need('cargoCategory', false, 'Contentor não tem categoria');
  } else {
    need('cargoCategory', volume.categories.includes(input.cargoCategory), 'Categoria inválida para este tipo de volume');
    if (isVehicleCategory(input.cargoCategory)) {
      need('vehicleBrand', !!input.vehicleBrand, 'Marca obrigatória para veículos');
      need('vehicleModel', !!input.vehicleModel, 'Modelo obrigatório para veículos');
    } else {
      need('description', !!input.description, 'Descrição obrigatória');
      need('quantity', input.quantity != null, 'Quantidade obrigatória');
      need('weightKg', input.weightKg != null, 'Peso obrigatório');
    }
  }
  if (input.client.isForeign) need('client.isForeign', input.client.type === 'EMPRESA', 'Só empresas podem ser estrangeiras');
  need('urgencyReason', !input.urgencyRequested || !!input.urgencyReason, 'Indique o motivo da urgência');
  return errors;
}

function validateDocuments(client, kinds) {
  const errors = [];
  if (!kinds.has('EP17') && !kinds.has('EP15')) errors.push({ field: 'documents', message: 'EP17 ou EP15 do porto é obrigatório' });
  if (client.type === 'SINGULAR' && !kinds.has('BILHETE')) {
    errors.push({ field: 'documents', message: 'Cópia do bilhete de identidade é obrigatória' });
  }
  // Empresa estrangeira sem alvará: o transitário assume a responsabilidade com o seu NIF.
  if (client.type === 'EMPRESA' && !client.isForeign && !kinds.has('ALVARA')) {
    errors.push({ field: 'documents', message: 'Alvará comercial é obrigatório para empresas' });
  }
  return errors;
}

// ---- operações -----------------------------------------------------------------------------
/** Submissão de um processo pelo transitário; `files` = [{ kind, file }] já gravados em disco. */
export async function createProcess(actor, input, files) {
  if (!isForwarder(actor)) throw forbidden('Apenas transitários submetem processos');

  const errors = [...validateCargo(input), ...validateDocuments(input.client, new Set(files.map((f) => f.kind)))];
  if (errors.length) throw badRequest('Dados inválidos', 'VALIDATION_ERROR', errors);

  const entity = await queryOne('SELECT id, code, active FROM entities WHERE id = ?', [input.entityId]);
  if (!entity) throw notFound('Entidade não encontrada');
  if (!entity.active) throw conflict('Entidade inativa', 'ENTITY_INACTIVE');
  if (!(await isApprovedIn(actor.forwarderId, entity.id))) {
    throw forbidden('O transitário não está aprovado neste terminal');
  }

  const c = input.client;
  const id = await withTransaction(async (conn) => {
    // Cliente reconhecido pelo documento: reutiliza e atualiza os dados.
    const [cl] = await conn.query(
      `INSERT INTO clients (forwarder_id, type, name, document_number, is_foreign, phone, email, address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE type = new.type, name = new.name, is_foreign = new.is_foreign,
         phone = COALESCE(new.phone, clients.phone), email = COALESCE(new.email, clients.email),
         address = COALESCE(new.address, clients.address), id = LAST_INSERT_ID(clients.id)`,
      [actor.forwarderId, c.type, c.name, c.documentNumber, c.isForeign ? 1 : 0, c.phone ?? null, c.email ?? null, c.address ?? null],
    );

    const ct = input.container;
    const [res] = await conn.query(
      `INSERT INTO processes (entity_id, forwarder_id, client_id, created_by, cargo_priority, priority_rank,
         urgency_requested, urgency_reason, volume_type, cargo_category, description, quantity, weight_kg,
         vehicle_brand, vehicle_model, container_plate, container_type, container_volume, container_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.id, actor.forwarderId, cl.insertId, actor.id, input.cargoPriority, CARGO_PRIORITIES[input.cargoPriority].rank,
        input.urgencyRequested ? 1 : 0, input.urgencyReason ?? null, input.volumeType, input.cargoCategory ?? null,
        input.description ?? null, input.quantity ?? null, input.weightKg ?? null,
        input.vehicleBrand ?? null, input.vehicleModel ?? null,
        ct?.plate ?? null, ct?.type ?? null, ct?.volume ?? null, ct?.weightKg ?? null,
      ],
    );
    const reference = `${entity.code.slice(0, 3)}-${new Date().getFullYear()}-${String(res.insertId).padStart(6, '0')}`;
    await conn.query('UPDATE processes SET reference = ? WHERE id = ?', [reference, res.insertId]);

    for (const { kind, file } of files) await insertDocument(conn, res.insertId, kind, file, actor.id);
    await conn.query(
      'INSERT INTO process_status_history (process_id, from_status, to_status, changed_by) VALUES (?, NULL, ?, ?)',
      [res.insertId, 'SUBMETIDO', actor.id],
    );
    await audit(actor, 'PROCESS_SUBMITTED', 'process', res.insertId, { entityId: entity.id, details: { reference }, conn });
    return res.insertId;
  });
  return getProcess(actor, id);
}

async function insertDocument(conn, processId, kind, file, userId) {
  await conn.query(
    `INSERT INTO process_documents (process_id, kind, original_name, stored_name, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [processId, kind, Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 255), file.filename, file.mimetype, file.size, userId],
  );
}

/** Fila: staff vê por prioridade (urgência, tipo de carga, ordem de chegada); transitário, mais recentes primeiro. */
export async function listProcesses(actor, { status, q, entityId, forwarderId } = {}) {
  const scope = scopeClause(actor);
  const where = [scope.sql];
  const params = [...scope.params];
  if (status) (where.push('p.status = ?'), params.push(status));
  if (q) {
    where.push('(p.reference LIKE ? OR c.name LIKE ? OR c.document_number LIKE ? OR f.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (isSuperAdmin(actor) && entityId) (where.push('p.entity_id = ?'), params.push(entityId));
  if (!isForwarder(actor) && forwarderId) (where.push('p.forwarder_id = ?'), params.push(forwarderId));

  const order = isForwarder(actor)
    ? 'p.submitted_at DESC, p.id DESC'
    : "(p.status IN ('CONCLUIDO','REJEITADO')) ASC, p.urgency_requested DESC, p.priority_rank ASC, p.submitted_at ASC, p.id ASC";
  const rows = await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`, params);
  return rows.map(mapProcess);
}

export async function getProcess(actor, id) {
  const process = mapProcess(await loadAccessible(actor, id));
  const [documents, history] = await Promise.all([
    query(
      `SELECT id, kind, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes,
              created_at AS createdAt FROM process_documents WHERE process_id = ? ORDER BY id`,
      [id],
    ),
    query(
      `SELECT h.from_status AS fromStatus, h.to_status AS toStatus, h.notes, h.created_at AS createdAt, u.name AS changedBy
         FROM process_status_history h JOIN users u ON u.id = h.changed_by WHERE h.process_id = ? ORDER BY h.id`,
      [id],
    ),
  ]);
  return { ...process, documents, history };
}

async function changeStatus(actor, process, toStatus, notes, conn = pool) {
  await conn.query('UPDATE processes SET status = ?, status_notes = ? WHERE id = ?', [toStatus, notes ?? null, process.id]);
  await conn.query(
    'INSERT INTO process_status_history (process_id, from_status, to_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
    [process.id, process.status, toStatus, actor.id, notes ?? null],
  );
  await audit(actor, 'PROCESS_STATUS_CHANGED', 'process', process.id, {
    entityId: process.entityId,
    details: { from: process.status, to: toStatus },
    conn,
  });
}

/** Análise pela Sogester (Loja, administrador da entidade ou super admin). */
export async function transition(actor, id, { status, notes }) {
  const process = await loadAccessible(actor, id);
  if (!(STAFF_TRANSITIONS[process.status] ?? []).includes(status)) {
    throw conflict(`Transição ${process.status} → ${status} não permitida`, 'INVALID_TRANSITION');
  }
  if (NOTES_REQUIRED.includes(status) && !notes) throw badRequest('Indique o motivo ou os documentos em falta', 'NOTES_REQUIRED');
  await changeStatus(actor, process, status, notes);
  return getProcess(actor, id);
}

/** O transitário anexa documentos pedidos; só enquanto o processo está em DOCUMENTOS_PENDENTES. */
export async function addDocument(actor, id, kind, file) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  if (process.status !== 'DOCUMENTOS_PENDENTES') {
    throw conflict('Só pode anexar documentos quando a Sogester os solicitar', 'NOT_ACCEPTING_DOCUMENTS');
  }
  await insertDocument(pool, id, kind, file, actor.id);
  await audit(actor, 'PROCESS_DOCUMENT_ADDED', 'process', id, { entityId: process.entityId, details: { kind } });
  return getProcess(actor, id);
}

/** Devolve o processo à análise depois de o transitário anexar o que faltava. */
export async function submitDocuments(actor, id) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  if (process.status !== 'DOCUMENTOS_PENDENTES') {
    throw conflict('O processo não aguarda documentos', 'INVALID_TRANSITION');
  }
  const sinceRequest = await queryOne(
    `SELECT COUNT(*) AS n FROM process_documents
      WHERE process_id = ? AND created_at >= (SELECT MAX(created_at) FROM process_status_history
                                              WHERE process_id = ? AND to_status = 'DOCUMENTOS_PENDENTES')`,
    [id, id],
  );
  if (!sinceRequest.n) throw badRequest('Anexe pelo menos um documento antes de submeter', 'NO_NEW_DOCUMENTS');
  await changeStatus(actor, process, 'DOCUMENTOS_SUBMETIDOS', null);
  return getProcess(actor, id);
}

export async function getDocumentFile(actor, processId, docId) {
  await loadAccessible(actor, processId);
  const doc = await queryOne(
    'SELECT original_name AS originalName, stored_name AS storedName, mime_type AS mimeType FROM process_documents WHERE id = ? AND process_id = ?',
    [docId, processId],
  );
  if (!doc) throw notFound('Documento não encontrado');
  return { ...doc, absolutePath: path.join(documentsDir, path.basename(doc.storedName)) };
}

export async function listClients(actor, { q } = {}) {
  if (!isForwarder(actor)) throw forbidden();
  const rows = await query(
    `SELECT id, type, name, document_number AS documentNumber, is_foreign AS isForeign, phone, email, address
       FROM clients WHERE forwarder_id = ? ${q ? 'AND (name LIKE ? OR document_number LIKE ?)' : ''}
      ORDER BY name LIMIT 50`,
    q ? [actor.forwarderId, `%${q}%`, `%${q}%`] : [actor.forwarderId],
  );
  return rows.map((r) => ({ ...r, isForeign: !!r.isForeign }));
}

export async function removeFiles(files) {
  await Promise.all(files.map(({ file }) => fs.rm(file.path, { force: true })));
}
