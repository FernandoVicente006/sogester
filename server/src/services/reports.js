import { query } from '../db/pool.js';
import { badRequest } from '../errors.js';
import { CARGO_PRIORITIES, VOLUME_TYPES } from '../cargo.js';
import { isSuperAdmin } from '../roles.js';
import { audit } from './audit.js';
import { toCsv } from './csv.js';

const MAX_ROWS = 20000; // limite de linhas lidas por relatório
const JSON_ROWS = 500; // linhas devolvidas na pré-visualização (o CSV leva todas)
const CLOSED = ['CONCLUIDO', 'REJEITADO', 'CANCELADO'];

export const STATUS_LABELS = {
  SUBMETIDO: 'Submetido',
  EM_ANALISE: 'Em análise',
  REJEITADO: 'Rejeitado',
  DOCUMENTOS_PENDENTES: 'Documentos pendentes',
  DOCUMENTOS_SUBMETIDOS: 'Documentos submetidos',
  EM_PROCESSAMENTO_INTERNO: 'Em processamento interno',
  PAGAMENTO_PENDENTE: 'Pendente de pagamento',
  PAGAMENTO_SUBMETIDO: 'Pagamento em análise',
  PAGAMENTO_CONFIRMADO: 'Aguarda recibo',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};

/** Quem tem de agir em cada estado (para localizar gargalos). */
export const WAITING_ON = {
  SUBMETIDO: 'Sogester (Loja)',
  EM_ANALISE: 'Sogester (Loja)',
  DOCUMENTOS_SUBMETIDOS: 'Sogester (Loja)',
  EM_PROCESSAMENTO_INTERNO: 'Sogester (Loja)',
  PAGAMENTO_SUBMETIDO: 'Sogester (Finanças)',
  PAGAMENTO_CONFIRMADO: 'Sogester (Finanças)',
  DOCUMENTOS_PENDENTES: 'Transitário',
  PAGAMENTO_PENDENTE: 'Transitário',
};

const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const hoursBetween = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 3600000 : null);
const avg = (list) => (list.length ? round(list.reduce((s, x) => s + x, 0) / list.length) : null);
const count = (rows, key) => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {});

// ---- filtros ---------------------------------------------------------------------------------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Período em datas locais [from, to] (inclusivas); por omissão, os últimos 90 dias. */
export function resolvePeriod({ from, to } = {}) {
  const end = to ?? ymd(new Date());
  const start = from ?? ymd(new Date(new Date(end).getTime() - 89 * 86400000));
  if (start > end) throw badRequest('A data inicial é posterior à final', 'INVALID_PERIOD');
  return { from: start, to: end };
}

/** Limita ao terminal do utilizador; o super admin pode escolher. */
function entityScope(actor, entityId) {
  const scope = isSuperAdmin(actor) ? entityId ?? null : actor.entityId;
  return scope ? { sql: 'p.entity_id = ?', params: [scope] } : { sql: '1 = 1', params: [] };
}

const periodSql = (column) => `${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`;

// ---- processos -------------------------------------------------------------------------------
export async function processesReport(actor, filters) {
  const period = resolvePeriod(filters);
  const scope = entityScope(actor, filters.entityId);
  const where = [scope.sql, periodSql('p.submitted_at')];
  const params = [...scope.params, period.from, period.to];
  if (filters.status) (where.push('p.status = ?'), params.push(filters.status));
  if (filters.priority) (where.push('p.cargo_priority = ?'), params.push(filters.priority));
  if (filters.forwarderId) (where.push('p.forwarder_id = ?'), params.push(filters.forwarderId));

  const rows = await query(
    `SELECT p.id, p.reference, e.code AS entityCode, f.name AS forwarderName, c.name AS clientName,
            c.document_number AS clientDocument, p.cargo_priority AS cargoPriority, p.volume_type AS volumeType,
            p.cargo_category AS cargoCategory, p.status, p.urgency_requested AS urgent, p.submitted_at AS submittedAt,
            a.at AS approvedAt, d.at AS completedAt, i.amount, i.currency
       FROM processes p
       JOIN entities e ON e.id = p.entity_id
       JOIN forwarders f ON f.id = p.forwarder_id
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN (SELECT process_id, MIN(created_at) AS at FROM process_status_history WHERE to_status IN ('EM_PROCESSAMENTO_INTERNO', 'AUTORIZACAO_EMITIDA') GROUP BY process_id) a ON a.process_id = p.id
       LEFT JOIN (SELECT process_id, MIN(created_at) AS at FROM process_status_history WHERE to_status = 'CONCLUIDO' GROUP BY process_id) d ON d.process_id = p.id
       LEFT JOIN invoices i ON i.process_id = p.id
      WHERE ${where.join(' AND ')}
      ORDER BY p.submitted_at DESC, p.id DESC LIMIT ?`,
    [...params, MAX_ROWS],
  );
  const data = rows.map((r) => ({
    ...r,
    urgent: !!r.urgent,
    amount: r.amount === null ? null : Number(r.amount),
    hoursToApproval: round(hoursBetween(r.submittedAt, r.approvedAt)),
    hoursToComplete: round(hoursBetween(r.submittedAt, r.completedAt)),
  }));

  const summary = {
    total: data.length,
    active: data.filter((r) => !CLOSED.includes(r.status)).length,
    completed: data.filter((r) => r.status === 'CONCLUIDO').length,
    cancelled: data.filter((r) => r.status === 'CANCELADO').length,
    rejected: data.filter((r) => r.status === 'REJEITADO').length,
    urgent: data.filter((r) => r.urgent).length,
    avgHoursToApproval: avg(data.map((r) => r.hoursToApproval).filter((h) => h !== null)),
    avgHoursToComplete: avg(data.map((r) => r.hoursToComplete).filter((h) => h !== null)),
    byStatus: count(data, 'status'),
    byPriority: count(data, 'cargoPriority'),
    byVolume: count(data, 'volumeType'),
    byForwarder: Object.entries(count(data, 'forwarderName'))
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
  };
  return { period, summary, rows: data, truncated: data.length >= MAX_ROWS };
}

const processColumns = [
  { label: 'Referência', value: (r) => r.reference },
  { label: 'Terminal', value: (r) => r.entityCode },
  { label: 'Transitário', value: (r) => r.forwarderName },
  { label: 'Cliente', value: (r) => r.clientName },
  { label: 'Documento do cliente', value: (r) => r.clientDocument },
  { label: 'Prioridade', value: (r) => CARGO_PRIORITIES[r.cargoPriority]?.label },
  { label: 'Urgência pedida', value: (r) => r.urgent },
  { label: 'Tipo de volume', value: (r) => VOLUME_TYPES[r.volumeType]?.label },
  { label: 'Tipo de carga', value: (r) => r.cargoCategory },
  { label: 'Estado', value: (r) => STATUS_LABELS[r.status] },
  { label: 'Submetido em', value: (r) => r.submittedAt },
  { label: 'Documentos conformes em', value: (r) => r.approvedAt },
  { label: 'Concluído em', value: (r) => r.completedAt },
  { label: 'Horas até conformidade', value: (r) => r.hoursToApproval },
  { label: 'Horas até conclusão', value: (r) => r.hoursToComplete },
  { label: 'Valor da proforma', value: (r) => r.amount },
  { label: 'Moeda', value: (r) => r.currency },
];

// ---- receita ---------------------------------------------------------------------------------
const month = (d) => `${new Date(d).getFullYear()}-${String(new Date(d).getMonth() + 1).padStart(2, '0')}`;

/**
 * Faturado = proformas emitidas no período; cobrado = pagamentos confirmados no período; em aberto = faturado ainda não confirmado.
 * O valor da proforma é opcional: as que não o têm ficam fora dos totais e são contadas em `withoutAmount`.
 */
export async function revenueReport(actor, filters) {
  const period = resolvePeriod(filters);
  const scope = entityScope(actor, filters.entityId);
  const where = [scope.sql, "p.status <> 'CANCELADO'", `(${periodSql('i.proforma_issued_at')} OR ${periodSql('i.payment_confirmed_at')})`];
  const params = [...scope.params, period.from, period.to, period.from, period.to];
  if (filters.forwarderId) (where.push('p.forwarder_id = ?'), params.push(filters.forwarderId));

  const rows = await query(
    `SELECT p.id, p.reference, e.code AS entityCode, f.id AS forwarderId, f.name AS forwarderName, p.status,
            i.proforma_number AS proformaNumber, i.amount, i.currency, i.proforma_issued_at AS proformaIssuedAt,
            i.payment_confirmed_at AS paymentConfirmedAt, i.receipt_number AS receiptNumber
       FROM invoices i
       JOIN processes p ON p.id = i.process_id
       JOIN entities e ON e.id = p.entity_id
       JOIN forwarders f ON f.id = p.forwarder_id
      WHERE ${where.join(' AND ')}
      ORDER BY i.proforma_issued_at DESC, i.id DESC LIMIT ?`,
    [...params, MAX_ROWS],
  );

  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T23:59:59`);
  const inRange = (d) => d && new Date(d) >= from && new Date(d) <= to;
  const data = rows.map((r) => ({ ...r, amount: r.amount === null ? null : Number(r.amount) }));

  const totals = {};
  const series = {};
  const byForwarder = {};
  const bucket = (currency) => (totals[currency] ??= { currency, invoiced: 0, collected: 0, outstanding: 0 });
  const point = (m, currency) => (series[`${m}|${currency}`] ??= { month: m, currency, invoiced: 0, collected: 0 });

  for (const r of data) {
    if (r.amount === null) continue;
    const t = bucket(r.currency);
    if (inRange(r.proformaIssuedAt)) {
      t.invoiced += r.amount;
      point(month(r.proformaIssuedAt), r.currency).invoiced += r.amount;
      if (!r.paymentConfirmedAt) t.outstanding += r.amount;
    }
    if (inRange(r.paymentConfirmedAt)) {
      t.collected += r.amount;
      point(month(r.paymentConfirmedAt), r.currency).collected += r.amount;
      const f = (byForwarder[`${r.forwarderId}|${r.currency}`] ??= { forwarder: r.forwarderName, currency: r.currency, collected: 0 });
      f.collected += r.amount;
    }
  }
  const money = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round(v, 2) : v]));
  return {
    period,
    totals: Object.values(totals).map(money),
    series: Object.values(series).map(money).sort((a, b) => a.month.localeCompare(b.month)),
    topForwarders: Object.values(byForwarder).map(money).sort((a, b) => b.collected - a.collected).slice(0, 10),
    withoutAmount: data.filter((r) => r.amount === null).length,
    rows: data,
    truncated: data.length >= MAX_ROWS,
  };
}

const revenueColumns = [
  { label: 'Referência', value: (r) => r.reference },
  { label: 'Terminal', value: (r) => r.entityCode },
  { label: 'Transitário', value: (r) => r.forwarderName },
  { label: 'Estado', value: (r) => STATUS_LABELS[r.status] },
  { label: 'N.º da proforma', value: (r) => r.proformaNumber },
  { label: 'Valor', value: (r) => r.amount },
  { label: 'Moeda', value: (r) => r.currency },
  { label: 'Proforma emitida em', value: (r) => r.proformaIssuedAt },
  { label: 'Pagamento confirmado em', value: (r) => r.paymentConfirmedAt },
  { label: 'Fatura recibo', value: (r) => r.receiptNumber },
];

// ---- atrasos ---------------------------------------------------------------------------------
/** Pagamentos em atraso (compromissos vencidos) e processos parados há mais de `minHours` no mesmo estado. */
export async function overdueReport(actor, filters) {
  const scope = entityScope(actor, filters.entityId);
  const minHours = filters.minHours ?? 24;

  const payments = (
    await query(
      `SELECT p.id, p.reference, e.code AS entityCode, f.name AS forwarderName, p.status, pc.due_at AS dueAt,
              TIMESTAMPDIFF(HOUR, pc.due_at, NOW()) AS hoursOverdue, pc.extension_count AS extensions, i.amount, i.currency
         FROM payment_commitments pc
         JOIN processes p ON p.id = pc.process_id
         JOIN entities e ON e.id = p.entity_id
         JOIN forwarders f ON f.id = p.forwarder_id
         LEFT JOIN invoices i ON i.process_id = p.id
        WHERE ${scope.sql} AND pc.due_at < NOW() AND p.status NOT IN ('PAGAMENTO_CONFIRMADO', 'CONCLUIDO', 'CANCELADO')
        ORDER BY pc.due_at LIMIT ?`,
      [...scope.params, MAX_ROWS],
    )
  ).map((r) => ({ ...r, amount: r.amount === null ? null : Number(r.amount), hoursOverdue: Number(r.hoursOverdue) }));

  const stalled = (
    await query(
      `SELECT p.id, p.reference, e.code AS entityCode, f.name AS forwarderName, p.status, p.cargo_priority AS cargoPriority,
              p.urgency_requested AS urgent, h.since, TIMESTAMPDIFF(HOUR, h.since, NOW()) AS hoursWaiting
         FROM processes p
         JOIN entities e ON e.id = p.entity_id
         JOIN forwarders f ON f.id = p.forwarder_id
         JOIN (SELECT process_id, MAX(created_at) AS since FROM process_status_history GROUP BY process_id) h ON h.process_id = p.id
        WHERE ${scope.sql} AND p.status NOT IN ('CONCLUIDO', 'REJEITADO', 'CANCELADO')
          AND h.since <= DATE_SUB(NOW(), INTERVAL ? HOUR)
        ORDER BY hoursWaiting DESC LIMIT ?`,
      [...scope.params, minHours, MAX_ROWS],
    )
  ).map((r) => ({ ...r, urgent: !!r.urgent, hoursWaiting: Number(r.hoursWaiting), waitingOn: WAITING_ON[r.status] ?? '' }));

  const owed = {};
  for (const r of payments) if (r.amount !== null) owed[r.currency] = round((owed[r.currency] ?? 0) + r.amount, 2);
  return {
    minHours,
    payments: { rows: payments, count: payments.length, owed: Object.entries(owed).map(([currency, amount]) => ({ currency, amount })) },
    stalled: { rows: stalled, count: stalled.length, byWaitingOn: count(stalled, 'waitingOn') },
  };
}

const paymentColumns = [
  { label: 'Referência', value: (r) => r.reference },
  { label: 'Terminal', value: (r) => r.entityCode },
  { label: 'Transitário', value: (r) => r.forwarderName },
  { label: 'Estado', value: (r) => STATUS_LABELS[r.status] },
  { label: 'Prazo de pagamento', value: (r) => r.dueAt },
  { label: 'Horas em atraso', value: (r) => r.hoursOverdue },
  { label: 'Prorrogações', value: (r) => r.extensions },
  { label: 'Valor em dívida', value: (r) => r.amount },
  { label: 'Moeda', value: (r) => r.currency },
];

const stalledColumns = [
  { label: 'Referência', value: (r) => r.reference },
  { label: 'Terminal', value: (r) => r.entityCode },
  { label: 'Transitário', value: (r) => r.forwarderName },
  { label: 'Estado', value: (r) => STATUS_LABELS[r.status] },
  { label: 'Prioridade', value: (r) => CARGO_PRIORITIES[r.cargoPriority]?.label },
  { label: 'Urgência pedida', value: (r) => r.urgent },
  { label: 'A aguardar', value: (r) => r.waitingOn },
  { label: 'No estado desde', value: (r) => r.since },
  { label: 'Horas à espera', value: (r) => r.hoursWaiting },
];

// ---- API -------------------------------------------------------------------------------------
export const REPORTS = {
  processes: { run: processesReport, columns: () => processColumns, rows: (r) => r.rows },
  revenue: { run: revenueReport, columns: () => revenueColumns, rows: (r) => r.rows },
  overdue: {
    run: overdueReport,
    columns: (filters) => (filters.kind === 'stalled' ? stalledColumns : paymentColumns),
    rows: (r, filters) => (filters.kind === 'stalled' ? r.stalled.rows : r.payments.rows),
  },
};

/** Devolve o relatório em JSON (pré-visualização) ou em CSV (completo); exportações ficam auditadas. */
export async function runReport(actor, name, filters, { csv = false } = {}) {
  const def = REPORTS[name];
  const result = await def.run(actor, filters);
  if (!csv) {
    // pré-visualização: o resumo cobre tudo, as linhas vão limitadas
    const cut = (rows) => rows.slice(0, JSON_ROWS);
    if (name === 'overdue') {
      return { ...result, payments: { ...result.payments, rows: cut(result.payments.rows) }, stalled: { ...result.stalled, rows: cut(result.stalled.rows) } };
    }
    return { ...result, totalRows: result.rows.length, rows: cut(result.rows) };
  }
  await audit(actor, 'REPORT_EXPORTED', 'report', name, { details: { filters } });
  return { csv: toCsv(def.columns(filters), def.rows(result, filters)), filename: `sogester-${name}${filters.kind ? `-${filters.kind}` : ''}-${ymd(new Date())}.csv` };
}
