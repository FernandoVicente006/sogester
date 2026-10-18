import { config } from '../config.js';
import { pool, query, queryOne } from '../db/pool.js';
import { notFound } from '../errors.js';
import { CARGO_PRIORITIES } from '../cargo.js';
import { ROLES } from '../roles.js';
import { mailEnabled, sendMail } from './mailer.js';

const { LOJA, ADMIN_ENTIDADE, CADASTRO, FATURACAO } = ROLES;
const STAFF_ALL = [LOJA, ADMIN_ENTIDADE, CADASTRO, FATURACAO];

/**
 * Eventos de processo: quem é avisado e com que texto. `forwarder` avisa os utilizadores do transitário;
 * `staff` avisa o pessoal da entidade com esses perfis. Todos vão por e-mail (se ativo), exceto o chat.
 */
const EVENTS = {
  PROCESS_SUBMITTED: {
    staff: [LOJA, ADMIN_ENTIDADE],
    title: (p) => `Novo processo ${p.reference}`,
    body: (p) => `${p.forwarderName} submeteu um processo (${CARGO_PRIORITIES[p.cargoPriority]?.label ?? 'carga'}).`,
  },
  ANALYSIS_STARTED: {
    forwarder: true,
    title: (p) => `Processo ${p.reference} em análise`,
    body: () => 'A Sogester iniciou a análise da documentação.',
  },
  DOCUMENTS_REQUESTED: {
    forwarder: true,
    title: (p) => `Documentos em falta no processo ${p.reference}`,
    body: (_p, notes) => notes || 'A Sogester pediu documentos adicionais.',
  },
  DOCUMENTS_RESUBMITTED: {
    staff: [LOJA, ADMIN_ENTIDADE],
    title: (p) => `Documentos reenviados — ${p.reference}`,
    body: (p) => `${p.forwarderName} anexou os documentos pedidos.`,
  },
  PROCESS_REJECTED: {
    forwarder: true,
    title: (p) => `Processo ${p.reference} rejeitado`,
    body: (_p, notes) => notes || 'O processo foi rejeitado.',
  },
  COMMITMENT_SIGNED: {
    staff: [LOJA, ADMIN_ENTIDADE],
    title: (p) => `Compromisso de pagamento assinado — ${p.reference}`,
    body: (p) => `${p.forwarderName} assinou o compromisso: pode emitir a autorização de saída antecipada.`,
  },
  AUTHORIZATION_ISSUED: {
    forwarder: true,
    staff: [FATURACAO],
    title: (p, audience) => (audience === 'staff' ? `Emitir proforma — ${p.reference}` : `Autorização emitida — ${p.reference}`),
    body: (_p, _n, audience) =>
      audience === 'staff' ? 'A autorização foi emitida: falta emitir a fatura proforma.' : 'A Sogester emitiu a autorização digital do processo.',
  },
  PROFORMA_ISSUED: {
    forwarder: true,
    title: (p) => `Proforma disponível — ${p.reference}`,
    body: () => 'Efetue o pagamento e carregue o comprovativo no processo.',
  },
  PAYMENT_PROOF_SUBMITTED: {
    staff: [FATURACAO, ADMIN_ENTIDADE],
    title: (p) => `Comprovativo para validar — ${p.reference}`,
    body: (p) => `${p.forwarderName} carregou o comprovativo de pagamento.`,
  },
  PAYMENT_PROOF_REJECTED: {
    forwarder: true,
    title: (p) => `Comprovativo recusado — ${p.reference}`,
    body: (_p, notes) => notes || 'O comprovativo foi recusado; carregue outro.',
  },
  PAYMENT_CONFIRMED: {
    forwarder: true,
    title: (p) => `Pagamento confirmado — ${p.reference}`,
    body: () => 'A Sogester confirmou o pagamento; a fatura recibo segue em breve.',
  },
  PROCESS_COMPLETED: {
    forwarder: true,
    title: (p) => `Processo ${p.reference} concluído`,
    body: () => 'A fatura recibo está disponível para descarregar.',
  },
  PROCESS_WITHDRAWN: {
    staff: [LOJA, ADMIN_ENTIDADE],
    title: (p) => `Processo ${p.reference} cancelado pelo transitário`,
    body: (p, notes) => `${p.forwarderName}: ${notes}`,
  },
  CANCELLATION_REQUESTED: {
    staff: [ADMIN_ENTIDADE, FATURACAO],
    title: (p) => `Pedido de cancelamento — ${p.reference}`,
    body: (p, notes) => `${p.forwarderName}: ${notes}`,
  },
  CANCELLATION_APPROVED: {
    forwarder: true,
    title: (p) => `Cancelamento aprovado — ${p.reference}`,
    body: (_p, notes) => notes || 'O processo foi cancelado a seu pedido.',
  },
  CANCELLATION_DENIED: {
    forwarder: true,
    title: (p) => `Cancelamento recusado — ${p.reference}`,
    body: (_p, notes) => notes || 'O pedido de cancelamento foi recusado.',
  },
  PROCESS_CANCELLED: {
    forwarder: true,
    title: (p) => `Processo ${p.reference} cancelado pela Sogester`,
    body: (_p, notes) => notes || 'O processo foi cancelado.',
  },
  AUTHORIZATION_REVOKED: {
    forwarder: true,
    title: (p) => `Autorização revogada — ${p.reference}`,
    body: (_p, notes) => notes || 'A autorização foi revogada e o processo voltou à análise.',
  },
  DEADLINE_EXTENDED: {
    forwarder: true,
    title: (p) => `Prazo de pagamento prorrogado — ${p.reference}`,
    body: (_p, notes) => notes || 'A Sogester prorrogou o prazo de pagamento.',
  },
  PROCESS_REOPENED: {
    forwarder: true,
    title: (p) => `Processo ${p.reference} reaberto`,
    body: (_p, notes) => notes || 'O processo voltou à análise.',
  },
  PAYMENT_DUE_SOON: {
    forwarder: true,
    title: (p) => `O prazo de pagamento de ${p.reference} termina em breve`,
    body: () => 'Liquide a proforma nas próximas 24 horas para manter novos compromissos disponíveis.',
  },
  PAYMENT_OVERDUE: {
    forwarder: true,
    staff: [FATURACAO, ADMIN_ENTIDADE],
    title: (p, audience) => (audience === 'staff' ? `Pagamento em atraso — ${p.reference}` : `Prazo de pagamento ultrapassado — ${p.reference}`),
    body: (p, _n, audience) =>
      audience === 'staff'
        ? `${p.forwarderName} não liquidou a carga libertada com compromisso de pagamento.`
        : 'O prazo terminou. Novos compromissos ficam bloqueados até liquidar.',
  },
};

// ---- destinatários -------------------------------------------------------------------------
const USER_FIELDS = 'id, name, email, email_notifications AS emailNotifications';

const forwarderUsers = (forwarderId) =>
  query(`SELECT ${USER_FIELDS} FROM users WHERE forwarder_id = ? AND role = 'TRANSITARIO' AND active = 1`, [forwarderId]);

const staffUsers = (entityId, roles) =>
  query(`SELECT ${USER_FIELDS} FROM users WHERE entity_id = ? AND role IN (?) AND active = 1`, [entityId, roles]);

async function insertNotification(user, { type, title, body, processId, email }) {
  const wantsEmail = email && mailEnabled() && user.emailNotifications;
  await pool.query(
    'INSERT INTO notifications (user_id, type, title, body, process_id, email_status) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, type, title.slice(0, 160), body ? body.slice(0, 500) : null, processId ?? null, wantsEmail ? 'PENDING' : 'NONE'],
  );
}

const safe = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    // Uma notificação falhada nunca pode impedir a ação do utilizador.
    console.error(`[notificações] ${label}:`, err.message);
  }
};

/** Avisa quem de direito sobre um evento do processo; `actor` nunca é avisado das próprias ações. */
export function notifyProcessEvent(event, process, { actor, notes } = {}) {
  return safe(event, async () => {
    const def = EVENTS[event];
    const audiences = [];
    if (def.forwarder) audiences.push(['forwarder', await forwarderUsers(process.forwarderId)]);
    if (def.staff) audiences.push(['staff', await staffUsers(process.entityId, def.staff)]);
    for (const [audience, users] of audiences) {
      for (const user of users) {
        if (user.id === actor?.id) continue;
        await insertNotification(user, {
          type: event,
          title: def.title(process, audience),
          body: def.body(process, notes, audience),
          processId: process.id,
          email: true,
        });
      }
    }
  });
}

/**
 * Nova mensagem no chat: agrupa numa só notificação por destinatário enquanto não for lida,
 * para não inundar. Só o transitário recebe e-mail; o pessoal usa o selo dentro da plataforma.
 */
export function notifyMessage(process, sender, text) {
  return safe('MESSAGE', async () => {
    const fromForwarder = sender.role === ROLES.TRANSITARIO;
    const recipients = fromForwarder ? await staffUsers(process.entityId, STAFF_ALL) : await forwarderUsers(process.forwarderId);
    const preview = `${sender.name}: ${(text || 'enviou um anexo').slice(0, 120)}`;
    for (const user of recipients) {
      if (user.id === sender.id) continue;
      const existing = await queryOne(
        "SELECT id FROM notifications WHERE user_id = ? AND process_id = ? AND type = 'MESSAGE' AND read_at IS NULL LIMIT 1",
        [user.id, process.id],
      );
      if (existing) {
        await pool.query('UPDATE notifications SET body = ?, created_at = NOW() WHERE id = ?', [preview.slice(0, 500), existing.id]);
      } else {
        await insertNotification(user, {
          type: 'MESSAGE',
          title: `Nova mensagem — ${process.reference}`,
          body: preview,
          processId: process.id,
          email: !fromForwarder,
        });
      }
    }
  });
}

/** Lembrete 24 h antes do prazo e alerta de atraso (uma vez por compromisso). */
export async function runPaymentChecks() {
  const select = `SELECT c.id AS commitmentId, p.id, p.reference, p.entity_id AS entityId, p.forwarder_id AS forwarderId, f.name AS forwarderName
                    FROM payment_commitments c
                    JOIN processes p ON p.id = c.process_id
                    JOIN forwarders f ON f.id = p.forwarder_id
                   WHERE p.status NOT IN ('PAGAMENTO_CONFIRMADO', 'CONCLUIDO', 'CANCELADO') AND c.due_at IS NOT NULL`;
  const dueSoon = await query(`${select} AND c.due_at > NOW() AND c.due_at <= DATE_ADD(NOW(), INTERVAL 24 HOUR) AND c.reminder_sent_at IS NULL`);
  for (const p of dueSoon) {
    await pool.query('UPDATE payment_commitments SET reminder_sent_at = NOW() WHERE id = ?', [p.commitmentId]);
    await notifyProcessEvent('PAYMENT_DUE_SOON', p);
  }
  const overdue = await query(`${select} AND c.due_at < NOW() AND c.overdue_notified_at IS NULL`);
  for (const p of overdue) {
    await pool.query('UPDATE payment_commitments SET overdue_notified_at = NOW() WHERE id = ?', [p.commitmentId]);
    await notifyProcessEvent('PAYMENT_OVERDUE', p);
  }
  return { dueSoon: dueSoon.length, overdue: overdue.length };
}

// ---- e-mail --------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderEmail(n, user) {
  const link = n.processId ? `${config.appUrl}/processos/${n.processId}` : config.appUrl;
  const text = [`Olá ${user.name},`, '', n.title, n.body ?? '', '', `Abrir na plataforma: ${link}`, '', 'Pode desativar os e-mails nas notificações da plataforma.']
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  const html = `<!doctype html><html lang="pt"><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#031b30;color:#fff;padding:18px 24px;font-size:18px;letter-spacing:3px;font-weight:bold">SOGESTER</td></tr>
      <tr><td style="padding:24px">
        <p style="margin:0 0 6px;color:#64748b;font-size:13px">Olá ${esc(user.name)},</p>
        <h2 style="margin:0 0 12px;font-size:18px;color:#031b30">${esc(n.title)}</h2>
        ${n.body ? `<p style="margin:0 0 20px;line-height:1.5">${esc(n.body)}</p>` : ''}
        <a href="${esc(link)}" style="display:inline-block;background:#054c83;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Abrir na plataforma</a>
      </td></tr>
      <tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px">Recebe este e-mail porque tem as notificações por e-mail ativas. Pode desativá-las na plataforma.</td></tr>
    </table></td></tr></table></body></html>`;
  return { subject: n.title, text, html };
}

/** Envia os e-mails pendentes; falhas ficam PENDING até esgotar as tentativas (depois FAILED). */
export async function processOutbox({ limit = 25 } = {}) {
  const rows = await query(
    `SELECT n.id, n.title, n.body, n.process_id AS processId, n.email_attempts AS attempts,
            u.name, u.email, u.active, u.email_notifications AS wants
       FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.email_status = 'PENDING' ORDER BY n.id LIMIT ?`,
    [limit],
  );
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const n of rows) {
    if (!n.active || !n.wants) {
      await pool.query("UPDATE notifications SET email_status = 'NONE' WHERE id = ?", [n.id]);
      result.skipped++;
      continue;
    }
    try {
      await sendMail({ to: n.email, ...renderEmail(n, n) });
      await pool.query("UPDATE notifications SET email_status = 'SENT', email_sent_at = NOW(), email_error = NULL WHERE id = ?", [n.id]);
      result.sent++;
    } catch (err) {
      const attempts = n.attempts + 1;
      await pool.query('UPDATE notifications SET email_status = ?, email_attempts = ?, email_error = ? WHERE id = ?', [
        attempts >= config.mail.maxAttempts ? 'FAILED' : 'PENDING',
        attempts,
        String(err.message).slice(0, 255),
        n.id,
      ]);
      result.failed++;
    }
  }
  return result;
}

// ---- consulta e leitura (API) --------------------------------------------------------------
export async function listNotifications(user, { unreadOnly = false, limit = 30 } = {}) {
  const rows = await query(
    `SELECT id, type, title, body, process_id AS processId, read_at AS readAt, created_at AS createdAt
       FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ?`,
    [user.id, limit],
  );
  const { n } = await queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [user.id]);
  return { notifications: rows, unread: Number(n), emailEnabled: mailEnabled() };
}

export async function markNotificationRead(user, id) {
  const [res] = await pool.query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?', [id, user.id]);
  if (!res.affectedRows) throw notFound('Notificação não encontrada');
}

export const markAllNotificationsRead = (user) =>
  pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [user.id]);

/** Ao abrir o chat do processo, a notificação agrupada de mensagens fica lida. */
export const markMessageNotificationsRead = (user, processId) =>
  pool.query("UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND process_id = ? AND type = 'MESSAGE' AND read_at IS NULL", [user.id, processId]);

export async function setEmailPreference(user, enabled) {
  await pool.query('UPDATE users SET email_notifications = ? WHERE id = ?', [enabled ? 1 : 0, user.id]);
}
