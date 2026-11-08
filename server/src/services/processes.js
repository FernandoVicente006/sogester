import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { CARGO_PRIORITIES, DOCUMENT_KINDS, UPLOADABLE_KINDS, VOLUME_TYPES, isVehicleCategory } from '../cargo.js';
import { ROLES, isForwarder, isSuperAdmin } from '../roles.js';
import { audit } from './audit.js';
import { isApprovedIn } from './forwarders.js';
import { notifyProcessEvent } from './notifications.js';

/** Prorrogações máximas do prazo de pagamento por compromisso. */
export const MAX_EXTENSIONS = 2;

export const documentsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/documents');

/** Transições da análise pela Loja; daí em diante o processo avança com a proforma, o comprovativo e o recibo. */
export const STAFF_TRANSITIONS = {
  SUBMETIDO: ['EM_ANALISE', 'REJEITADO'],
  EM_ANALISE: ['EM_PROCESSAMENTO_INTERNO', 'DOCUMENTOS_PENDENTES', 'REJEITADO'],
  DOCUMENTOS_PENDENTES: ['REJEITADO'], // sem resposta do transitário
  DOCUMENTOS_SUBMETIDOS: ['EM_ANALISE', 'EM_PROCESSAMENTO_INTERNO', 'DOCUMENTOS_PENDENTES', 'REJEITADO'],
  EM_PROCESSAMENTO_INTERNO: ['DOCUMENTOS_PENDENTES', 'REJEITADO'], // anomalia detetada nos procedimentos internos
};
const NOTES_REQUIRED = ['REJEITADO'];

/** Campos que a Loja pode marcar como errados e o transitário corrige sem refazer o processo. */
export const CORRECTABLE_FIELDS = {
  blNumber: { column: 'bl_number', label: 'N.º do B/L' },
  duNumber: { column: 'du_number', label: 'N.º do DU' },
  vesselName: { column: 'vessel_name', label: 'Navio' },
  voyageNumber: { column: 'voyage_number', label: 'N.º da viagem' },
  dischargeType: { column: 'discharge_type', label: 'Tipo de descarga' },
  regime: { column: 'regime', label: 'Regime' },
  manifestNumber: { column: 'manifest_number', label: 'N.º do manifesto' },
  weightKg: { column: 'weight_kg', label: 'Peso bruto (kg)' },
  packagesCount: { column: 'packages_count', label: 'N.º de volumes' },
  originCountry: { column: 'origin_country', label: 'País de origem' },
  destinationCountry: { column: 'destination_country', label: 'País de destino' },
  description: { column: 'description', label: 'Descrição geral' },
};
/** Estados finais: o processo vai para os Arquivados. */
export const ARCHIVED_STATUSES = ['CONCLUIDO', 'REJEITADO', 'CANCELADO'];

const SELECT = `
  SELECT p.id, p.reference, p.entity_id AS entityId, e.code AS entityCode, p.forwarder_id AS forwarderId,
         f.name AS forwarderName, p.status, p.status_notes AS statusNotes,
         p.cargo_priority AS cargoPriority, p.priority_rank AS priorityRank,
         p.urgency_requested AS urgencyRequested, p.urgency_reason AS urgencyReason,
         p.volume_type AS volumeType, p.cargo_category AS cargoCategory, p.description, p.weight_kg AS weightKg,
         p.bl_number AS blNumber, p.du_number AS duNumber, p.vessel_name AS vesselName, p.voyage_number AS voyageNumber,
         p.discharge_type AS dischargeType, p.regime, p.manifest_number AS manifestNumber, p.packages_count AS packagesCount,
         p.origin_country AS originCountry, p.destination_country AS destinationCountry,
         p.submitted_at AS submittedAt, p.updated_at AS updatedAt, p.archived_at AS archivedAt,
         c.id AS clientId, c.type AS clientType, c.name AS clientName, c.document_number AS clientDocument,
         c.is_foreign AS clientIsForeign,
         (pc.id IS NOT NULL) AS hasCommitment,
         (pc.due_at IS NOT NULL AND pc.due_at < NOW()
            AND p.status NOT IN ('PAGAMENTO_CONFIRMADO', 'CONCLUIDO', 'CANCELADO')) AS paymentOverdue
    FROM processes p
    JOIN entities e ON e.id = p.entity_id
    JOIN forwarders f ON f.id = p.forwarder_id
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN payment_commitments pc ON pc.process_id = p.id`;

const num = (v) => (v === null || v === undefined ? null : Number(v));

function mapProcess(r) {
  const { clientId, clientType, clientName, clientDocument, clientIsForeign, ...p } = r;
  return {
    ...p,
    urgencyRequested: !!p.urgencyRequested,
    hasCommitment: !!p.hasCommitment,
    paymentOverdue: !!p.paymentOverdue,
    weightKg: num(p.weightKg),
    client: { id: clientId, type: clientType, name: clientName, documentNumber: clientDocument, isForeign: !!clientIsForeign },
  };
}

/** Condição SQL que limita os processos visíveis ao ator. */
export function scopeClause(actor) {
  // A Portaria só verifica autorizações pelo código; não consulta processos.
  if (actor.role === ROLES.PORTARIA) throw forbidden('A Portaria só verifica autorizações');
  if (isForwarder(actor)) return { sql: 'p.forwarder_id = ?', params: [actor.forwarderId] };
  if (isSuperAdmin(actor)) return { sql: '1 = 1', params: [] };
  return { sql: 'p.entity_id = ?', params: [actor.entityId] };
}

export async function loadAccessible(actor, id) {
  const scope = scopeClause(actor);
  const row = await queryOne(`${SELECT} WHERE p.id = ? AND ${scope.sql}`, [id, ...scope.params]);
  if (!row) throw notFound('Processo não encontrado');
  return row;
}

/** Mensagens de outros ainda não lidas pelo ator, por processo. */
export async function unreadByProcess(actor, processIds) {
  if (!processIds.length) return new Map();
  const rows = await query(
    `SELECT m.process_id AS processId, COUNT(*) AS n
       FROM process_messages m
       LEFT JOIN message_reads r ON r.process_id = m.process_id AND r.user_id = ?
      WHERE m.process_id IN (?) AND m.sender_id <> ? AND m.id > COALESCE(r.last_read_id, 0)
      GROUP BY m.process_id`,
    [actor.id, processIds, actor.id],
  );
  return new Map(rows.map((r) => [r.processId, Number(r.n)]));
}

// ---- validação de regras de negócio --------------------------------------------------------
function validateCargo(input) {
  const errors = [];
  const need = (field, ok, message) => !ok && errors.push({ field, message });
  const volume = VOLUME_TYPES[input.volumeType];

  const { vehicles, containers, goods } = input;
  // O tipo de volume é o tipo principal da carga; as listas detalham-na e podem misturar tipos.
  if (input.volumeType === 'CONTENTOR') {
    if (input.cargoCategory) need('cargoCategory', false, 'Contentor não tem categoria');
    need('containers', containers.length > 0, 'Indique pelo menos um contentor');
  } else {
    need('cargoCategory', volume.categories.includes(input.cargoCategory), 'Categoria inválida para este tipo de volume');
    if (isVehicleCategory(input.cargoCategory)) need('vehicles', vehicles.length > 0, 'Indique pelo menos um veículo');
    else need('goods', goods.length > 0, 'Indique pelo menos uma mercadoria');
  }
  goods.forEach((g, i) => {
    need(`goods.${i}.vehicle`, g.vehicle === undefined || g.vehicle < vehicles.length, 'Veículo inexistente');
    need(`goods.${i}.container`, g.container === undefined || g.container < containers.length, 'Contentor inexistente');
    need(`goods.${i}`, g.vehicle === undefined || g.container === undefined, 'A mercadoria está num veículo ou num contentor, não nos dois');
  });
  const numbers = containers.map((c) => c.number);
  need('containers', new Set(numbers).size === numbers.length, 'Contentor repetido');
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

    const [res] = await conn.query(
      `INSERT INTO processes (entity_id, forwarder_id, client_id, created_by, cargo_priority, priority_rank,
         urgency_requested, urgency_reason, volume_type, cargo_category, description, weight_kg,
         bl_number, du_number, vessel_name, voyage_number, discharge_type, regime, manifest_number, packages_count,
         origin_country, destination_country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.id, actor.forwarderId, cl.insertId, actor.id, input.cargoPriority, CARGO_PRIORITIES[input.cargoPriority].rank,
        input.urgencyRequested ? 1 : 0, input.urgencyReason ?? null, input.volumeType, input.cargoCategory ?? null,
        input.description ?? null, input.weightKg, input.blNumber, input.duNumber, input.vesselName, input.voyageNumber,
        input.dischargeType, input.regime ?? null, input.manifestNumber ?? null, input.packagesCount ?? null,
        input.originCountry ?? null, input.destinationCountry ?? null,
      ],
    );
    await insertCargoItems(conn, res.insertId, input);
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
  const created = await getProcess(actor, id);
  await notifyProcessEvent('PROCESS_SUBMITTED', created, { actor });
  return created;
}

/** Grava as listas; as mercadorias referem o veículo ou contentor que as transporta pela posição na lista. */
async function insertCargoItems(conn, processId, { vehicles, containers, goods }) {
  const vehicleIds = [];
  for (const [i, v] of vehicles.entries()) {
    const [r] = await conn.query(
      'INSERT INTO process_vehicles (process_id, position, chassis, brand, model, tariff_code, fuel) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [processId, i + 1, v.chassis, v.brand, v.model, v.tariffCode ?? null, v.fuel ?? null],
    );
    vehicleIds.push(r.insertId);
  }
  const containerIds = [];
  for (const [i, c] of containers.entries()) {
    const [r] = await conn.query(
      `INSERT INTO process_containers (process_id, position, number, size, type, load_status, seal, packages, weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [processId, i + 1, c.number, c.size, c.type ?? null, c.loadStatus ?? null, c.seal ?? null, c.packages ?? null, c.weightKg ?? null],
    );
    containerIds.push(r.insertId);
  }
  for (const [i, g] of goods.entries()) {
    await conn.query(
      `INSERT INTO process_goods (process_id, position, description, tariff_code, unit, quantity, weight_kg, vehicle_id, container_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        processId, i + 1, g.description, g.tariffCode ?? null, g.unit, g.quantity, g.weightKg ?? null,
        g.vehicle === undefined ? null : vehicleIds[g.vehicle], g.container === undefined ? null : containerIds[g.container],
      ],
    );
  }
}

export async function insertDocument(conn, processId, kind, file, userId) {
  await conn.query(
    `INSERT INTO process_documents (process_id, kind, original_name, stored_name, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [processId, kind, Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 255), file.filename, file.mimetype, file.size, userId],
  );
}

/** Fila: staff vê por prioridade (urgência, tipo de carga, ordem de chegada); transitário, mais recentes primeiro. */
export async function listProcesses(actor, { status, q, entityId, forwarderId, archived = false } = {}) {
  const scope = scopeClause(actor);
  const where = [scope.sql, archived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL'];
  const params = [...scope.params];
  if (status) (where.push('p.status IN (?)'), params.push(status.split(',')));
  if (q) {
    where.push('(p.reference LIKE ? OR c.name LIKE ? OR c.document_number LIKE ? OR f.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (isSuperAdmin(actor) && entityId) (where.push('p.entity_id = ?'), params.push(entityId));
  if (!isForwarder(actor) && forwarderId) (where.push('p.forwarder_id = ?'), params.push(forwarderId));

  const order = archived
    ? 'p.archived_at DESC, p.id DESC'
    : isForwarder(actor)
      ? 'p.submitted_at DESC, p.id DESC'
      : 'p.urgency_requested DESC, p.priority_rank ASC, p.submitted_at ASC, p.id ASC';
  const rows = await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`, params);
  const unread = await unreadByProcess(actor, rows.map((r) => r.id));
  return rows.map((r) => ({ ...mapProcess(r), unreadMessages: unread.get(r.id) ?? 0 }));
}

/** Indicadores do painel, limitados ao que o ator pode ver. */
export async function processStats(actor) {
  const scope = scopeClause(actor);
  const rows = await query(
    `SELECT p.status, COUNT(*) AS n,
            SUM(p.urgency_requested = 1) AS urgent,
            SUM(p.cargo_priority = 'PERECIVEL') AS perishable,
            SUM(pc.due_at IS NOT NULL AND pc.due_at < NOW()) AS overdue
       FROM processes p
       LEFT JOIN payment_commitments pc ON pc.process_id = p.id
      WHERE ${scope.sql}
      GROUP BY p.status`,
    scope.params,
  );
  const byStatus = {};
  const stats = { total: 0, active: 0, urgent: 0, perishable: 0, overdue: 0 };
  for (const r of rows) {
    byStatus[r.status] = Number(r.n);
    stats.total += Number(r.n);
    if (!['CONCLUIDO', 'REJEITADO', 'CANCELADO'].includes(r.status)) {
      stats.active += Number(r.n);
      stats.urgent += Number(r.urgent);
      stats.perishable += Number(r.perishable);
    }
    if (!['PAGAMENTO_CONFIRMADO', 'CONCLUIDO', 'CANCELADO'].includes(r.status)) stats.overdue += Number(r.overdue);
  }
  const n = (...s) => s.reduce((a, k) => a + (byStatus[k] ?? 0), 0);
  return {
    ...stats,
    byStatus,
    awaitingReview: n('SUBMETIDO', 'DOCUMENTOS_SUBMETIDOS'),
    awaitingDocuments: n('DOCUMENTOS_PENDENTES'),
    awaitingPaymentValidation: n('PAGAMENTO_SUBMETIDO'),
    awaitingPayment: n('PAGAMENTO_PENDENTE'),
    awaitingReceipt: n('PAGAMENTO_CONFIRMADO'),
    completed: n('CONCLUIDO'),
    cancelled: n('CANCELADO'),
  };
}

export async function getProcess(actor, id) {
  const process = mapProcess(await loadAccessible(actor, id));
  const [documents, history, commitment, authorization, invoice, extensions, vehicles, containers, goods, issues] = await Promise.all([
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
    queryOne(
      `SELECT c.signed_at AS signedAt, c.due_at AS dueAt, c.terms_version AS termsVersion, c.extension_count AS extensionCount, u.name AS signedBy
         FROM payment_commitments c JOIN users u ON u.id = c.signed_by WHERE c.process_id = ?`,
      [id],
    ),
    queryOne(
      `SELECT a.code, a.type, a.issued_at AS issuedAt, a.notes, a.reason, a.valid_until AS validUntil,
              (a.commitment_id IS NOT NULL) AS accepted, a.used_at AS usedAt, g.name AS usedBy, u.name AS issuedBy
         FROM authorizations a
         JOIN users u ON u.id = a.issued_by
         LEFT JOIN users g ON g.id = a.used_by
        WHERE a.process_id = ? AND a.revoked_at IS NULL`,
      [id],
    ),
    queryOne(
      `SELECT proforma_number AS proformaNumber, amount, currency, payment_entity AS paymentEntity,
              payment_reference AS paymentReference, proforma_issued_at AS proformaIssuedAt,
              proof_submitted_at AS proofSubmittedAt, payment_confirmed_at AS paymentConfirmedAt,
              receipt_number AS receiptNumber, receipt_issued_at AS receiptIssuedAt
         FROM invoices WHERE process_id = ?`,
      [id],
    ),
    query(
      `SELECT e.days, e.reason, e.new_due_at AS newDueAt, e.created_at AS createdAt, u.name AS extendedBy
         FROM commitment_extensions e
         JOIN payment_commitments c ON c.id = e.commitment_id
         JOIN users u ON u.id = e.extended_by
        WHERE c.process_id = ? ORDER BY e.id`,
      [id],
    ),
    query(
      `SELECT id, chassis, brand, model, tariff_code AS tariffCode, fuel FROM process_vehicles WHERE process_id = ? ORDER BY position`,
      [id],
    ),
    query(
      `SELECT id, number, size, type, load_status AS loadStatus, seal, packages, weight_kg AS weightKg
         FROM process_containers WHERE process_id = ? ORDER BY position`,
      [id],
    ),
    query(
      `SELECT g.description, g.tariff_code AS tariffCode, g.unit, g.quantity, g.weight_kg AS weightKg,
              v.chassis AS vehicleChassis, CONCAT(v.brand, ' ', v.model) AS vehicleName, c.number AS containerNumber
         FROM process_goods g
         LEFT JOIN process_vehicles v ON v.id = g.vehicle_id
         LEFT JOIN process_containers c ON c.id = g.container_id
        WHERE g.process_id = ? ORDER BY g.position`,
      [id],
    ),
    query(
      `SELECT i.id, i.kind, i.document_id AS documentId, i.document_kind AS documentKind, i.field, i.label, i.reason,
              i.created_at AS createdAt, u.name AS createdBy, i.fixed_at AS fixedAt, i.old_value AS oldValue,
              i.new_value AS newValue, i.closed_at AS closedAt
         FROM process_issues i JOIN users u ON u.id = i.created_by
        WHERE i.process_id = ? ORDER BY i.id`,
      [id],
    ),
  ]);
  const containerList = containers.map((c) => ({ ...c, weightKg: num(c.weightKg) }));
  return {
    ...process,
    unreadMessages: (await unreadByProcess(actor, [id])).get(id) ?? 0,
    documents,
    history,
    vehicles,
    containers: containerList,
    containerTotals: Object.fromEntries(['20', '40', '45'].map((s) => [s, containerList.filter((c) => c.size === s).length])),
    goods: goods.map((g) => ({ ...g, quantity: num(g.quantity), weightKg: num(g.weightKg) })),
    issues,
    commitment: commitment ? { ...commitment, extensions, extensionsLeft: Math.max(0, MAX_EXTENSIONS - commitment.extensionCount) } : null,
    authorization: authorization ? { ...authorization, accepted: !!authorization.accepted } : null,
    invoice: invoice ? { ...invoice, amount: num(invoice.amount) } : null,
  };
}

/** Muda o estado só se ainda for o que o ator viu (evita duas ações concorrentes sobre o mesmo processo). */
export async function changeStatus(actor, process, toStatus, notes, conn = pool) {
  // Estados finais arquivam o processo; reabrir um rejeitado tira-o do arquivo.
  const [res] = await conn.query(
    `UPDATE processes SET status = ?, status_notes = ?, archived_at = ${ARCHIVED_STATUSES.includes(toStatus) ? 'NOW()' : 'NULL'}
      WHERE id = ? AND status = ?`,
    [toStatus, notes ?? null, process.id, process.status],
  );
  if (!res.affectedRows) throw conflict('O processo foi alterado entretanto; atualize a página', 'STALE_STATE');
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
/** Valida as correções pedidas e prepara o texto de cada uma (fica guardado, mesmo que o documento mude). */
async function prepareIssues(processId, issues) {
  const prepared = [];
  for (const [i, issue] of issues.entries()) {
    const bad = (message) => badRequest('Correção inválida', 'VALIDATION_ERROR', [{ field: `issues.${i}`, message }]);
    if (issue.kind === 'DOCUMENTO') {
      const doc = await queryOne('SELECT id, kind, original_name AS name FROM process_documents WHERE id = ? AND process_id = ?', [issue.documentId ?? 0, processId]);
      if (!doc || !UPLOADABLE_KINDS.includes(doc.kind)) throw bad('Documento inexistente neste processo');
      prepared.push({ ...issue, documentKind: doc.kind, label: `${DOCUMENT_KINDS[doc.kind]}: ${doc.name}` });
    } else if (issue.kind === 'EM_FALTA') {
      if (!UPLOADABLE_KINDS.includes(issue.documentKind)) throw bad('Indique o tipo de documento em falta');
      prepared.push({ ...issue, documentId: null, label: `Em falta: ${DOCUMENT_KINDS[issue.documentKind]}` });
    } else {
      if (!CORRECTABLE_FIELDS[issue.field]) throw bad('Campo que não pode ser corrigido');
      prepared.push({ ...issue, documentId: null, documentKind: null, label: CORRECTABLE_FIELDS[issue.field].label });
    }
  }
  return prepared;
}

export async function transition(actor, id, { status, notes, issues = [] }) {
  const process = await loadAccessible(actor, id);
  if (!(STAFF_TRANSITIONS[process.status] ?? []).includes(status)) {
    throw conflict(`Transição ${process.status} → ${status} não permitida`, 'INVALID_TRANSITION');
  }
  if (NOTES_REQUIRED.includes(status) && !notes) throw badRequest('Indique o motivo ou os documentos em falta', 'NOTES_REQUIRED');
  if (status === 'DOCUMENTOS_PENDENTES' && !notes && !issues.length) {
    throw badRequest('Indique o que tem de ser corrigido', 'NOTES_REQUIRED');
  }
  const prepared = status === 'DOCUMENTOS_PENDENTES' ? await prepareIssues(id, issues) : [];
  // O resumo das correções é o motivo que o transitário vê e que fica no histórico.
  const summary = prepared.map((p) => `${p.label} — ${p.reason}`).join('; ');
  notes = [notes, summary].filter(Boolean).join(' · ').slice(0, 500) || notes;
  if (status === 'REJEITADO' && (await queryOne('SELECT id FROM authorizations WHERE process_id = ? AND revoked_at IS NULL', [id]))) {
    throw conflict('Há uma saída antecipada ativa: revogue-a antes de rejeitar', 'EARLY_RELEASE_BINDING');
  }
  await withTransaction(async (conn) => {
    await changeStatus(actor, process, status, notes, conn);
    if (status === 'DOCUMENTOS_PENDENTES') {
      await conn.query(
        'UPDATE processes SET docs_baseline_id = (SELECT COALESCE(MAX(id), 0) FROM process_documents WHERE process_id = ?) WHERE id = ?',
        [id, id],
      );
      for (const p of prepared) {
        await conn.query(
          `INSERT INTO process_issues (process_id, kind, document_id, document_kind, field, label, reason, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, p.kind, p.documentId ?? null, p.documentKind ?? null, p.field ?? null, p.label, p.reason, actor.id],
        );
      }
    }
    if (status === 'REJEITADO') {
      await conn.query('UPDATE process_issues SET closed_at = NOW() WHERE process_id = ? AND closed_at IS NULL', [id]);
    }
  });
  const event = {
    EM_ANALISE: process.status === 'SUBMETIDO' ? 'ANALYSIS_STARTED' : null,
    EM_PROCESSAMENTO_INTERNO: 'DOCUMENTS_APPROVED',
    DOCUMENTOS_PENDENTES: 'DOCUMENTS_REQUESTED',
    REJEITADO: 'PROCESS_REJECTED',
  }[status];
  if (event) await notifyProcessEvent(event, process, { actor, notes });
  return getProcess(actor, id);
}

/** O transitário anexa documentos pedidos; só enquanto o processo está em DOCUMENTOS_PENDENTES. */
export async function addDocument(actor, id, kind, file) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  if (process.status !== 'DOCUMENTOS_PENDENTES') {
    throw conflict('Só pode anexar documentos quando a Sogester os solicitar', 'NOT_ACCEPTING_DOCUMENTS');
  }
  await withTransaction(async (conn) => {
    await insertDocument(conn, id, kind, file, actor.id);
    // Um documento do tipo pedido resolve as correções desse tipo (substituição ou documento em falta).
    await conn.query(
      `UPDATE process_issues SET fixed_at = NOW(), fixed_document_id = LAST_INSERT_ID()
        WHERE process_id = ? AND closed_at IS NULL AND fixed_at IS NULL AND document_kind = ?`,
      [id, kind],
    );
    await audit(actor, 'PROCESS_DOCUMENT_ADDED', 'process', id, { entityId: process.entityId, details: { kind }, conn });
  });
  return getProcess(actor, id);
}

/** O transitário corrige os campos que a Loja marcou como errados. */
export async function correctFields(actor, id, values) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  if (process.status !== 'DOCUMENTOS_PENDENTES') throw conflict('O processo não aguarda correções', 'INVALID_TRANSITION');
  const fields = Object.keys(values).filter((f) => values[f] !== undefined);
  if (!fields.length) throw badRequest('Indique o valor corrigido', 'VALIDATION_ERROR');

  await withTransaction(async (conn) => {
    for (const field of fields) {
      const [[issue]] = await conn.query(
        "SELECT id FROM process_issues WHERE process_id = ? AND closed_at IS NULL AND kind = 'CAMPO' AND field = ?",
        [id, field],
      );
      if (!issue) throw conflict(`A Sogester não pediu a correção de «${CORRECTABLE_FIELDS[field].label}»`, 'FIELD_NOT_REQUESTED');
      const { column } = CORRECTABLE_FIELDS[field];
      const [[current]] = await conn.query(`SELECT ${column} AS value FROM processes WHERE id = ?`, [id]);
      await conn.query(`UPDATE processes SET ${column} = ? WHERE id = ?`, [values[field], id]);
      await conn.query('UPDATE process_issues SET fixed_at = NOW(), old_value = ?, new_value = ? WHERE id = ?', [
        current.value === null ? null : String(current.value).slice(0, 255),
        String(values[field]).slice(0, 255),
        issue.id,
      ]);
    }
    await audit(actor, 'PROCESS_FIELDS_CORRECTED', 'process', id, { entityId: process.entityId, details: values, conn });
  });
  return getProcess(actor, id);
}

/** Devolve o processo à análise depois de o transitário anexar o que faltava. */
export async function submitDocuments(actor, id) {
  if (!isForwarder(actor)) throw forbidden();
  const process = await loadAccessible(actor, id);
  if (process.status !== 'DOCUMENTOS_PENDENTES') {
    throw conflict('O processo não aguarda documentos', 'INVALID_TRANSITION');
  }
  const open = await query('SELECT id, label, fixed_at AS fixedAt FROM process_issues WHERE process_id = ? AND closed_at IS NULL', [id]);
  if (open.length) {
    const pending = open.filter((i) => !i.fixedAt);
    if (pending.length) {
      throw badRequest('Ainda há correções por fazer', 'ISSUES_PENDING', pending.map((i) => ({ field: `issue.${i.id}`, message: i.label })));
    }
  } else {
    // Pedido sem correções detalhadas: basta enviar pelo menos um documento novo.
    const sinceRequest = await queryOne(
      'SELECT COUNT(*) AS n FROM process_documents WHERE process_id = ? AND id > (SELECT docs_baseline_id FROM processes WHERE id = ?)',
      [id, id],
    );
    if (!sinceRequest.n) throw badRequest('Anexe pelo menos um documento antes de submeter', 'NO_NEW_DOCUMENTS');
  }
  await withTransaction(async (conn) => {
    const fixed = open.map((i) => i.label).join('; ');
    await changeStatus(actor, process, 'DOCUMENTOS_SUBMETIDOS', fixed ? `Corrigido: ${fixed}`.slice(0, 500) : null, conn);
    await conn.query('UPDATE process_issues SET closed_at = NOW() WHERE process_id = ? AND closed_at IS NULL', [id]);
  });
  await notifyProcessEvent('DOCUMENTS_RESUBMITTED', process, { actor });
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
