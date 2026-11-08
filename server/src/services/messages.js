import path from 'node:path';
import { pool, query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { ROLES } from '../roles.js';
import { audit } from './audit.js';
import { markMessageNotificationsRead, notifyMessage } from './notifications.js';
import { documentsDir, loadAccessible, scopeClause } from './processes.js';

const CLOSED = ['CONCLUIDO', 'REJEITADO', 'CANCELADO'];
const PAGE = 200;

const fixName = (name) => Buffer.from(name, 'latin1').toString('utf8').slice(0, 255); // multer lê o nome como latin1

function mapMessage(m, attachments) {
  return {
    id: m.id,
    senderId: m.senderId,
    senderName: m.senderName,
    side: m.senderRole === 'TRANSITARIO' ? 'TRANSITARIO' : 'SOGESTER',
    body: m.body,
    createdAt: m.createdAt,
    attachments: attachments.filter((a) => a.messageId === m.id).map(({ messageId, ...a }) => a),
  };
}

/** Mensagens do processo: as últimas, ou só as posteriores a `after` (para atualização periódica). */
export async function listMessages(actor, processId, { after } = {}) {
  await loadAccessible(actor, processId);
  const rows = after
    ? await query(
        `SELECT m.id, m.sender_id AS senderId, u.name AS senderName, u.role AS senderRole, m.body, m.created_at AS createdAt
           FROM process_messages m JOIN users u ON u.id = m.sender_id
          WHERE m.process_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`,
        [processId, after, PAGE],
      )
    : (
        await query(
          `SELECT m.id, m.sender_id AS senderId, u.name AS senderName, u.role AS senderRole, m.body, m.created_at AS createdAt
             FROM process_messages m JOIN users u ON u.id = m.sender_id
            WHERE m.process_id = ? ORDER BY m.id DESC LIMIT ?`,
          [processId, PAGE],
        )
      ).reverse();

  const attachments = rows.length
    ? await query(
        `SELECT id, message_id AS messageId, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes
           FROM message_attachments WHERE message_id IN (?) ORDER BY id`,
        [rows.map((r) => r.id)],
      )
    : [];
  return rows.map((m) => mapMessage(m, attachments));
}

/** Envia uma mensagem (texto e/ou anexos) em nome do ator; ambas as partes podem escrever. */
export async function postMessage(actor, processId, body, files) {
  const process = await loadAccessible(actor, processId);
  if (CLOSED.includes(process.status)) throw conflict('O processo está encerrado; a conversa é só de leitura', 'CHAT_CLOSED');
  const text = (body ?? '').trim();
  if (!text && !files.length) throw badRequest('Escreva uma mensagem ou anexe um ficheiro', 'EMPTY_MESSAGE');
  if (text.length > 4000) throw badRequest('Mensagem demasiado longa (máx. 4000 caracteres)', 'MESSAGE_TOO_LONG');

  const id = await withTransaction(async (conn) => {
    const [res] = await conn.query('INSERT INTO process_messages (process_id, sender_id, body) VALUES (?, ?, ?)', [
      processId,
      actor.id,
      text || null,
    ]);
    for (const f of files) {
      await conn.query(
        'INSERT INTO message_attachments (message_id, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)',
        [res.insertId, fixName(f.originalname), f.filename, f.mimetype, f.size],
      );
    }
    // Quem escreve já leu tudo até aqui.
    await conn.query(
      'INSERT INTO message_reads (user_id, process_id, last_read_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id))',
      [actor.id, processId, res.insertId],
    );
    return res.insertId;
  });
  await notifyMessage(process, actor, text);
  const [message] = await listMessages(actor, processId, { after: id - 1 });
  return message;
}

export async function markRead(actor, processId) {
  await loadAccessible(actor, processId);
  await markMessageNotificationsRead(actor, processId);
  await pool.query(
    `INSERT INTO message_reads (user_id, process_id, last_read_id)
     SELECT ?, ?, COALESCE(MAX(id), 0) FROM process_messages WHERE process_id = ?
     ON DUPLICATE KEY UPDATE last_read_id = GREATEST(message_reads.last_read_id, VALUES(last_read_id))`,
    [actor.id, processId, processId],
  );
}

export async function getAttachmentFile(actor, processId, messageId, attachmentId) {
  await loadAccessible(actor, processId);
  const att = await queryOne(
    `SELECT a.original_name AS originalName, a.stored_name AS storedName, a.mime_type AS mimeType
       FROM message_attachments a JOIN process_messages m ON m.id = a.message_id
      WHERE a.id = ? AND a.message_id = ? AND m.process_id = ?`,
    [attachmentId, messageId, processId],
  );
  if (!att) throw notFound('Anexo não encontrado');
  return { ...att, absolutePath: path.join(documentsDir, path.basename(att.storedName)) };
}

/** Total de mensagens por ler em todos os processos que o ator vê (selo na navegação). */
export async function unreadTotal(actor) {
  if (actor.role === ROLES.PORTARIA) return 0; // a Portaria não participa nas conversas
  const scope = scopeClause(actor);
  const row = await queryOne(
    `SELECT COUNT(*) AS n
       FROM process_messages m
       JOIN processes p ON p.id = m.process_id
       LEFT JOIN message_reads r ON r.process_id = m.process_id AND r.user_id = ?
      WHERE ${scope.sql} AND m.sender_id <> ? AND m.id > COALESCE(r.last_read_id, 0)`,
    [actor.id, ...scope.params, actor.id],
  );
  return Number(row.n);
}

