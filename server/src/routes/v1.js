import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { CARGO_PRIORITIES, CONTAINER_SIZES, DISCHARGE_TYPES, REGIMES, UNITS, UPLOADABLE_KINDS, VOLUME_TYPES, cargoCatalog } from '../cargo.js';
import { badRequest, forbidden } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../roles.js';
import * as auth from '../services/auth.js';
import * as billing from '../services/billing.js';
import * as entities from '../services/entities.js';
import * as exceptions from '../services/exceptions.js';
import * as forwarders from '../services/forwarders.js';
import * as messages from '../services/messages.js';
import * as notifications from '../services/notifications.js';
import * as processes from '../services/processes.js';
import * as reports from '../services/reports.js';
import * as setup from '../services/setup.js';
import * as users from '../services/users.js';

export const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

const { SUPER_ADMIN, ADMIN_ENTIDADE, CADASTRO, LOJA, FINANCAS, CHEFE_COMERCIAL, PORTARIA, TRANSITARIO } = ROLES;
const STAFF_ASSIGNABLE = [ADMIN_ENTIDADE, LOJA, CADASTRO, FINANCAS, CHEFE_COMERCIAL, PORTARIA];

const MANAGE_FORWARDERS = [SUPER_ADMIN, ADMIN_ENTIDADE, CADASTRO];

// ---- schemas -------------------------------------------------------------------------------
const id = z.coerce.number().int().positive();
const email = z.string().trim().toLowerCase().email().max(160);
const password = z.string().min(8, 'Mínimo de 8 caracteres').max(100);
const text = (max) => z.string().trim().min(1).max(max);
const nif = z.string().trim().min(5).max(30).regex(/^[A-Za-z0-9]+$/, 'NIF só pode ter letras e números');
const idParam = z.object({ id });

const schemas = {
  login: z.object({ email, password: z.string().min(1).max(100) }),
  changePassword: z.object({ currentPassword: z.string().min(1), newPassword: password }),
  setup: z.object({ name: text(120), email, password }),
  entityCreate: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Código com 2 a 20 letras, números, - ou _'),
    name: text(120),
    location: text(120),
    active: z.boolean().optional(),
  }),
  entityPatch: z.object({ name: text(120).optional(), location: text(120).optional(), active: z.boolean().optional() }),
  userCreate: z.object({
    name: text(120),
    email,
    password,
    role: z.enum(STAFF_ASSIGNABLE),
    entityId: id.optional(),
  }),
  userPatch: z.object({
    name: text(120).optional(),
    role: z.enum(STAFF_ASSIGNABLE).optional(),
    active: z.boolean().optional(),
    password: password.optional(),
    canManageTerminals: z.boolean().optional(),
  }),
  forwarderCreate: z.object({
    name: text(160),
    nif,
    email,
    phone: z.string().trim().max(40).optional(),
    location: text(160),
    extraIdentifiers: z.record(z.string(), z.string().max(200)).optional(),
    entityIds: z.array(id).optional(),
    user: z.object({ name: text(120), email, password }).optional(),
  }),
  forwarderPatch: z.object({
    name: text(160).optional(),
    email: email.optional(),
    phone: z.string().trim().max(40).optional(),
    location: text(160).optional(),
    extraIdentifiers: z.record(z.string(), z.string().max(200)).optional(),
    active: z.boolean().optional(),
  }),
  forwarderList: z.object({
    status: z.enum(['PENDENTE', 'APROVADO', 'REJEITADO', 'SUSPENSO']).optional(),
    q: z.string().trim().max(100).optional(),
    entityId: id.optional(),
  }),
  linkStatus: z.object({
    status: z.enum(['PENDENTE', 'APROVADO', 'REJEITADO', 'SUSPENSO']),
    notes: z.string().trim().max(500).optional(),
  }),
  processCreate: z.object({
    entityId: id,
    client: z.object({
      type: z.enum(['SINGULAR', 'EMPRESA']),
      name: text(160),
      documentNumber: text(40),
      isForeign: z.boolean().optional(),
      phone: z.string().trim().max(40).optional(),
      email: email.optional(),
      address: z.string().trim().max(255).optional(),
    }),
    cargoPriority: z.enum(Object.keys(CARGO_PRIORITIES)),
    volumeType: z.enum(Object.keys(VOLUME_TYPES)),
    cargoCategory: text(100).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    // transporte (como na nota de desalfandegamento)
    blNumber: text(60),
    duNumber: text(60),
    vesselName: text(120),
    voyageNumber: text(40),
    dischargeType: z.enum(Object.keys(DISCHARGE_TYPES)),
    regime: z.enum(Object.keys(REGIMES)).optional(),
    manifestNumber: text(60).optional(),
    weightKg: z.number().positive().max(1e9),
    packagesCount: z.number().int().positive().max(1e7).optional(),
    originCountry: text(80).optional(),
    destinationCountry: text(80).optional(),
    // listas: um processo pode misturar veículos, contentores e mercadorias
    vehicles: z
      .array(z.object({ chassis: text(40), brand: text(80), model: text(80), tariffCode: text(20).optional(), fuel: text(40).optional() }))
      .max(200)
      .default([]),
    containers: z
      .array(
        z.object({
          number: z.string().trim().toUpperCase().min(4).max(20),
          size: z.enum(CONTAINER_SIZES),
          type: text(40).optional(),
          loadStatus: z.enum(['CHEIO', 'VAZIO']).optional(),
          seal: text(40).optional(),
          packages: z.number().int().positive().max(1e7).optional(),
          weightKg: z.number().positive().max(1e9).optional(),
        }),
      )
      .max(200)
      .default([]),
    goods: z
      .array(
        z.object({
          description: text(255),
          tariffCode: text(20).optional(),
          unit: z.enum(UNITS),
          quantity: z.number().positive().max(1e9),
          weightKg: z.number().positive().max(1e9).optional(),
          vehicle: z.number().int().min(0).optional(), // índice na lista de veículos que a transporta
          container: z.number().int().min(0).optional(), // ou na de contentores
        }),
      )
      .max(500)
      .default([]),
    urgencyRequested: z.boolean().optional(),
    urgencyReason: z.string().trim().max(500).optional(),
  }),
  processList: z.object({
    status: z.string().trim().max(120).optional(), // um estado ou vários separados por vírgulas
    archived: z.enum(['0', '1']).optional(),
    q: z.string().trim().max(100).optional(),
    entityId: id.optional(),
    forwarderId: id.optional(),
  }),
  reason: z.object({ reason: z.string().trim().min(5, 'Indique o motivo (mín. 5 caracteres)').max(500) }),
  cancellationDecision: z.object({ approve: z.boolean(), notes: z.string().trim().max(500).optional() }),
  extendDeadline: z.object({ days: z.number().int().min(1).max(7), reason: z.string().trim().min(5, 'Indique o motivo (mín. 5 caracteres)').max(500) }),
  commitmentSign: z.object({ password: z.string().min(1).max(100), accept: z.boolean() }),
  optionalNotes: z.object({ notes: z.string().trim().max(500).optional() }),
  requiredNotes: z.object({ notes: z.string().trim().min(1, 'Indique o motivo').max(500) }),
  proforma: z.object({
    number: text(40).optional(),
    amount: z.number().positive().max(1e12).optional(),
    currency: z.string().trim().toUpperCase().length(3).optional(),
    paymentEntity: text(40).optional(),
    paymentReference: text(60).optional(),
  }),
  receipt: z.object({ number: text(40).optional() }),
  authorizationCode: z.object({ code: z.string().regex(/^AUT-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i).transform((c) => c.toUpperCase()) }),
  processTransition: z.object({
    status: z.enum(['EM_ANALISE', 'EM_PROCESSAMENTO_INTERNO', 'DOCUMENTOS_PENDENTES', 'REJEITADO']),
    notes: z.string().trim().max(500).optional(),
  }),
};

// ---- upload de documentos de processos (privados) ------------------------------------------
const DOC_TYPES = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };
const DOC_FIELDS = {
  bilhete: 'BILHETE',
  alvara: 'ALVARA',
  guiaCabotagem: 'GUIA_CABOTAGEM',
  bl: 'BL',
  ep17: 'EP17',
  ep15: 'EP15',
  outros: 'OUTRO',
};
fs.mkdirSync(processes.documentsDir, { recursive: true });
const docUpload = multer({
  storage: multer.diskStorage({
    destination: processes.documentsDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${DOC_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) =>
    DOC_TYPES[file.mimetype] ? cb(null, true) : cb(badRequest('Documentos devem ser PDF, PNG ou JPG', 'INVALID_FILE_TYPE')),
});
const removeUploaded = (files) => processes.removeFiles(files).catch(() => {});

// ---- upload de logótipo --------------------------------------------------------------------
const LOGO_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(uploadsDir, 'logos'),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${LOGO_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    LOGO_TYPES[file.mimetype] ? cb(null, true) : cb(badRequest('Logótipo deve ser PNG, JPG ou WebP', 'INVALID_FILE_TYPE')),
});

// ---- rotas ---------------------------------------------------------------------------------
export const v1 = Router();

v1.get('/health', (_req, res) => res.json({ status: 'ok' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas tentativas; tente mais tarde' } },
});

// Autenticação
v1.post('/auth/login', loginLimiter, validate({ body: schemas.login }), async (req, res) => {
  res.json(await auth.login(req.valid.body.email, req.valid.body.password));
});
v1.get('/auth/me', authenticate, (req, res) => res.json({ user: auth.publicUser(req.user) }));
v1.post('/auth/change-password', authenticate, validate({ body: schemas.changePassword }), async (req, res) => {
  await auth.changePassword(req.user, req.valid.body.currentPassword, req.valid.body.newPassword);
  res.status(204).end();
});

// Inicialização única: cria o super administrador e fecha o setup para sempre (protegida por token)
v1.get('/setup/status', async (_req, res) => res.json(await setup.setupStatus()));
v1.post('/setup/super-admin', loginLimiter, validate({ body: schemas.setup }), async (req, res) => {
  const user = await setup.createSuperAdmin(req.get('x-setup-token'), req.valid.body);
  res.status(201).json({ user });
});

// Terminais: criar e editar só o super administrador ou quem ele designar
const requireTerminalManager = (req, _res, next) => {
  if (!entities.canManageTerminals(req.user)) throw forbidden();
  next();
};
v1.get('/entities', authenticate, async (req, res) => {
  const all = await entities.listEntities();
  res.json({ entities: entities.canManageTerminals(req.user) ? all : all.filter((e) => e.id === req.user.entityId) });
});
v1.post('/entities', authenticate, requireTerminalManager, validate({ body: schemas.entityCreate }), async (req, res) =>
  res.status(201).json({ entity: await entities.createEntity(req.user, req.valid.body) }),
);
v1.patch(
  '/entities/:id',
  authenticate,
  requireTerminalManager,
  validate({ params: idParam, body: schemas.entityPatch }),
  async (req, res) => res.json({ entity: await entities.updateEntity(req.user, req.valid.params.id, req.valid.body) }),
);

// Funcionários Sogester
v1.get('/users', authenticate, requireRole(SUPER_ADMIN, ADMIN_ENTIDADE), async (req, res) => {
  const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;
  res.json({ users: await users.listUsers(req.user, { entityId }) });
});
v1.post(
  '/users',
  authenticate,
  requireRole(SUPER_ADMIN, ADMIN_ENTIDADE),
  validate({ body: schemas.userCreate }),
  async (req, res) => res.status(201).json({ user: await users.createUser(req.user, req.valid.body) }),
);
v1.patch(
  '/users/:id',
  authenticate,
  requireRole(SUPER_ADMIN, ADMIN_ENTIDADE),
  validate({ params: idParam, body: schemas.userPatch }),
  async (req, res) => res.json({ user: await users.updateUser(req.user, req.valid.params.id, req.valid.body) }),
);

// Transitários
v1.get(
  '/forwarders',
  authenticate,
  validate({ query: schemas.forwarderList }),
  async (req, res) => res.json({ forwarders: await forwarders.listForwarders(req.user, req.valid.query) }),
);
v1.post(
  '/forwarders',
  authenticate,
  requireRole(...MANAGE_FORWARDERS),
  validate({ body: schemas.forwarderCreate }),
  async (req, res) => res.status(201).json({ forwarder: await forwarders.createForwarder(req.user, req.valid.body) }),
);
v1.post(
  '/forwarders/link',
  authenticate,
  requireRole(ADMIN_ENTIDADE, CADASTRO),
  validate({ body: z.object({ nif }) }),
  async (req, res) => res.status(201).json({ forwarder: await forwarders.linkByNif(req.user, req.valid.body.nif) }),
);
v1.get(
  '/forwarders/:id',
  authenticate,
  validate({ params: idParam }),
  async (req, res) => res.json({ forwarder: await forwarders.getForwarder(req.user, req.valid.params.id) }),
);
v1.patch(
  '/forwarders/:id',
  authenticate,
  requireRole(...MANAGE_FORWARDERS, TRANSITARIO),
  validate({ params: idParam, body: schemas.forwarderPatch }),
  async (req, res) =>
    res.json({ forwarder: await forwarders.updateForwarder(req.user, req.valid.params.id, req.valid.body) }),
);
v1.put(
  '/forwarders/:id/entities/:entityId',
  authenticate,
  requireRole(...MANAGE_FORWARDERS),
  validate({ params: z.object({ id, entityId: id }), body: schemas.linkStatus }),
  async (req, res) => {
    const { id: forwarderId, entityId } = req.valid.params;
    res.json({ forwarder: await forwarders.setLinkStatus(req.user, forwarderId, entityId, req.valid.body) });
  },
);
v1.post(
  '/forwarders/:id/logo',
  authenticate,
  requireRole(...MANAGE_FORWARDERS, TRANSITARIO),
  validate({ params: idParam }),
  upload.single('logo'),
  async (req, res) => {
    if (!req.file) throw badRequest('Ficheiro "logo" em falta', 'FILE_REQUIRED');
    res.json({ forwarder: await forwarders.setLogo(req.user, req.valid.params.id, req.file) });
  },
);

// Catálogo de carga (prioridades, tipos de volume, categorias, documentos)
v1.get('/meta/cargo', authenticate, (_req, res) => res.json(cargoCatalog()));

// Clientes do transitário (autocompletar na submissão)
v1.get('/clients', authenticate, requireRole(TRANSITARIO), async (req, res) => {
  res.json({ clients: await processes.listClients(req.user, { q: String(req.query.q ?? '').slice(0, 100) || undefined }) });
});

// Processos
v1.post(
  '/processes',
  authenticate,
  requireRole(TRANSITARIO),
  docUpload.fields(Object.entries(DOC_FIELDS).map(([name]) => ({ name, maxCount: name === 'outros' ? 5 : 1 }))),
  async (req, res) => {
    const files = Object.entries(req.files ?? {}).flatMap(([field, list]) => list.map((file) => ({ kind: DOC_FIELDS[field], file })));
    try {
      let raw;
      try {
        raw = JSON.parse(req.body?.data ?? '');
      } catch {
        throw badRequest('Campo "data" deve ser JSON', 'BAD_JSON');
      }
      const parsed = schemas.processCreate.safeParse(raw);
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
        throw badRequest('Dados inválidos', 'VALIDATION_ERROR', details);
      }
      res.status(201).json({ process: await processes.createProcess(req.user, parsed.data, files) });
    } catch (err) {
      await removeUploaded(files);
      throw err;
    }
  },
);
v1.get('/processes/stats', authenticate, async (req, res) => res.json({ stats: await processes.processStats(req.user) }));
v1.get(
  '/processes',
  authenticate,
  validate({ query: schemas.processList }),
  async (req, res) => res.json({ processes: await processes.listProcesses(req.user, req.valid.query) }),
);
v1.get(
  '/processes/:id',
  authenticate,
  validate({ params: idParam }),
  async (req, res) => res.json({ process: await processes.getProcess(req.user, req.valid.params.id) }),
);
v1.post(
  '/processes/:id/transition',
  authenticate,
  requireRole(SUPER_ADMIN, ADMIN_ENTIDADE, LOJA),
  validate({ params: idParam, body: schemas.processTransition }),
  async (req, res) =>
    res.json({ process: await processes.transition(req.user, req.valid.params.id, req.valid.body) }),
);
v1.post(
  '/processes/:id/documents',
  authenticate,
  requireRole(TRANSITARIO),
  validate({ params: idParam }),
  docUpload.single('file'),
  async (req, res) => {
    const files = req.file ? [{ file: req.file }] : [];
    try {
      const kind = String(req.body?.kind ?? '');
      if (!req.file || !UPLOADABLE_KINDS.includes(kind)) {
        throw badRequest('Indique "kind" válido e o ficheiro "file"', 'VALIDATION_ERROR');
      }
      res.status(201).json({ process: await processes.addDocument(req.user, req.valid.params.id, kind, req.file) });
    } catch (err) {
      await removeUploaded(files);
      throw err;
    }
  },
);
v1.post(
  '/processes/:id/submit-documents',
  authenticate,
  requireRole(TRANSITARIO),
  validate({ params: idParam }),
  async (req, res) => res.json({ process: await processes.submitDocuments(req.user, req.valid.params.id) }),
);
v1.get(
  '/processes/:id/documents/:docId',
  authenticate,
  validate({ params: z.object({ id, docId: id }) }),
  async (req, res) => {
    const doc = await processes.getDocumentFile(req.user, req.valid.params.id, req.valid.params.docId);
    res.sendFile(doc.absolutePath, {
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  },
);

// ---- saída antecipada, proforma e pagamento --------------------------------------------------
const AUTHORIZERS = [SUPER_ADMIN, ADMIN_ENTIDADE, CHEFE_COMERCIAL];
const PROFORMA_UPLOADERS = [SUPER_ADMIN, ADMIN_ENTIDADE, LOJA];
const FINANCE = [SUPER_ADMIN, ADMIN_ENTIDADE, FINANCAS];

/** Lê o JSON opcional do campo multipart "data" e valida-o; apaga os ficheiros enviados se algo falhar. */
function withUpload(fileField, schema, handler) {
  return [
    docUpload.single(fileField),
    async (req, res) => {
      const files = req.file ? [{ file: req.file }] : [];
      try {
        if (!req.file) throw badRequest(`Ficheiro "${fileField}" em falta`, 'FILE_REQUIRED');
        let data = {};
        if (schema) {
          let rawData;
          try {
            rawData = JSON.parse(req.body?.data || '{}');
          } catch {
            throw badRequest('Campo "data" deve ser JSON', 'BAD_JSON');
          }
          const parsed = schema.safeParse(rawData);
          if (!parsed.success) {
            const details = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
            throw badRequest('Dados inválidos', 'VALIDATION_ERROR', details);
          }
          data = parsed.data;
        }
        res.json({ process: await handler(req, data) });
      } catch (err) {
        await removeUploaded(files);
        throw err;
      }
    },
  ];
}

v1.get('/processes/:id/commitment-terms', authenticate, requireRole(TRANSITARIO), validate({ params: idParam }), async (req, res) =>
  res.json(await billing.getCommitmentTerms(req.user, req.valid.params.id)),
);
v1.post(
  '/processes/:id/commitment',
  authenticate,
  requireRole(TRANSITARIO),
  validate({ params: idParam, body: schemas.commitmentSign }),
  async (req, res) =>
    res.status(201).json({ process: await billing.signCommitment(req.user, req.valid.params.id, req.valid.body, req.ip) }),
);
v1.post(
  '/processes/:id/authorization',
  authenticate,
  requireRole(...AUTHORIZERS),
  validate({ params: idParam, body: schemas.optionalNotes }),
  async (req, res) =>
    res.status(201).json({ process: await billing.issueAuthorization(req.user, req.valid.params.id, req.valid.body) }),
);
v1.post(
  '/processes/:id/proforma',
  authenticate,
  requireRole(...PROFORMA_UPLOADERS),
  validate({ params: idParam }),
  ...withUpload('proforma', schemas.proforma, (req, data) =>
    billing.issueProforma(req.user, req.valid.params.id, data, req.file),
  ),
);
v1.post(
  '/processes/:id/payment-proof',
  authenticate,
  requireRole(TRANSITARIO),
  validate({ params: idParam }),
  ...withUpload('proof', null, (req) => billing.submitPaymentProof(req.user, req.valid.params.id, req.file)),
);
v1.post(
  '/processes/:id/confirm-payment',
  authenticate,
  requireRole(...FINANCE),
  validate({ params: idParam, body: schemas.optionalNotes }),
  async (req, res) =>
    res.json({ process: await billing.confirmPayment(req.user, req.valid.params.id, req.valid.body) }),
);
v1.post(
  '/processes/:id/reject-payment',
  authenticate,
  requireRole(...FINANCE),
  validate({ params: idParam, body: schemas.requiredNotes }),
  async (req, res) =>
    res.json({ process: await billing.rejectPayment(req.user, req.valid.params.id, req.valid.body) }),
);
v1.post(
  '/processes/:id/receipt',
  authenticate,
  requireRole(...FINANCE),
  validate({ params: idParam }),
  ...withUpload('receipt', schemas.receipt, (req, data) =>
    billing.issueReceipt(req.user, req.valid.params.id, data, req.file),
  ),
);

// ---- notificações --------------------------------------------------------------------------
v1.get(
  '/notifications',
  authenticate,
  validate({ query: z.object({ unread: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) }),
  async (req, res) =>
    res.json(await notifications.listNotifications(req.user, { unreadOnly: req.valid.query.unread === '1', limit: req.valid.query.limit })),
);
v1.post('/notifications/read-all', authenticate, async (req, res) => {
  await notifications.markAllNotificationsRead(req.user);
  res.status(204).end();
});
v1.post('/notifications/:id/read', authenticate, validate({ params: idParam }), async (req, res) => {
  await notifications.markNotificationRead(req.user, req.valid.params.id);
  res.status(204).end();
});
v1.patch('/auth/preferences', authenticate, validate({ body: z.object({ emailNotifications: z.boolean() }) }), async (req, res) => {
  await notifications.setEmailPreference(req.user, req.valid.body.emailNotifications);
  res.json({ emailNotifications: req.valid.body.emailNotifications });
});

// ---- cancelamento e exceções ----------------------------------------------------------------
const EXCEPTION_ADMINS = [SUPER_ADMIN, ADMIN_ENTIDADE];
const process_ = (fn) => async (req, res) => res.json({ process: await fn(req.user, req.valid.params.id, req.valid.body) });
v1.post('/processes/:id/cancellation', authenticate, requireRole(TRANSITARIO), validate({ params: idParam, body: schemas.reason }), process_(exceptions.withdrawProcess));
v1.post('/processes/:id/cancel', authenticate, requireRole(...EXCEPTION_ADMINS), validate({ params: idParam, body: schemas.reason }), process_(exceptions.staffCancel));
v1.post('/processes/:id/authorization/revoke', authenticate, requireRole(...EXCEPTION_ADMINS), validate({ params: idParam, body: schemas.reason }), process_(exceptions.revokeAuthorization));
v1.post('/processes/:id/extend-deadline', authenticate, requireRole(...EXCEPTION_ADMINS), validate({ params: idParam, body: schemas.extendDeadline }), process_(exceptions.extendDeadline));
v1.post('/processes/:id/reopen', authenticate, requireRole(...EXCEPTION_ADMINS), validate({ params: idParam, body: schemas.reason }), process_(exceptions.reopenProcess));

// ---- relatórios ------------------------------------------------------------------------------
const REPORT_ROLES = {
  processes: [SUPER_ADMIN, ADMIN_ENTIDADE, LOJA, CADASTRO, FINANCAS, CHEFE_COMERCIAL],
  revenue: [SUPER_ADMIN, ADMIN_ENTIDADE, FINANCAS, CHEFE_COMERCIAL],
  overdue: [SUPER_ADMIN, ADMIN_ENTIDADE, FINANCAS, CHEFE_COMERCIAL],
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD').refine((d) => !Number.isNaN(Date.parse(d)), 'Data inválida')
const reportQuery = z.object({
  from: date.optional(),
  to: date.optional(),
  status: z.enum(Object.keys(reports.STATUS_LABELS)).optional(),
  priority: z.enum(Object.keys(CARGO_PRIORITIES)).optional(),
  forwarderId: id.optional(),
  entityId: id.optional(),
  minHours: z.coerce.number().int().min(0).max(720).optional(),
  kind: z.enum(['payments', 'stalled']).optional(),
  format: z.enum(['json', 'csv']).optional(),
})
v1.get(
  '/reports/:name',
  authenticate,
  validate({ params: z.object({ name: z.enum(['processes', 'revenue', 'overdue']) }), query: reportQuery }),
  async (req, res) => {
    const { name } = req.valid.params
    if (!REPORT_ROLES[name].includes(req.user.role)) throw forbidden()
    const { format, ...filters } = req.valid.query
    if (format === 'csv') {
      const { csv, filename } = await reports.runReport(req.user, name, filters, { csv: true })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Cache-Control', 'private, no-store')
      return res.send(csv)
    }
    res.json({ report: await reports.runReport(req.user, name, filters) })
  },
)

// ---- chat por processo ---------------------------------------------------------------------
v1.get('/messages/unread', authenticate, async (req, res) => res.json({ total: await messages.unreadTotal(req.user) }));
v1.get(
  '/processes/:id/messages',
  authenticate,
  validate({ params: idParam, query: z.object({ after: z.coerce.number().int().min(0).optional() }) }),
  async (req, res) =>
    res.json({ messages: await messages.listMessages(req.user, req.valid.params.id, { after: req.valid.query.after }) }),
);
v1.post(
  '/processes/:id/messages',
  authenticate,
  validate({ params: idParam }),
  docUpload.array('files', 3),
  async (req, res) => {
    const files = (req.files ?? []).map((file) => ({ file }));
    try {
      const body = typeof req.body?.text === 'string' ? req.body.text : '';
      res.status(201).json({ message: await messages.postMessage(req.user, req.valid.params.id, body, req.files ?? []) });
    } catch (err) {
      await removeUploaded(files);
      throw err;
    }
  },
);
v1.post('/processes/:id/messages/read', authenticate, validate({ params: idParam }), async (req, res) => {
  await messages.markRead(req.user, req.valid.params.id);
  res.status(204).end();
});
v1.get(
  '/processes/:id/messages/:messageId/attachments/:attId',
  authenticate,
  validate({ params: z.object({ id, messageId: id, attId: id }) }),
  async (req, res) => {
    const { id: processId, messageId, attId } = req.valid.params;
    const att = await messages.getAttachmentFile(req.user, processId, messageId, attId);
    res.sendFile(att.absolutePath, {
      headers: {
        'Content-Type': att.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.originalName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  },
);

// Verificação pública de um código de autorização (sem dados do cliente)
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados pedidos; tente mais tarde' } },
});
v1.get('/verify/authorization/:code', verifyLimiter, validate({ params: schemas.authorizationCode }), async (req, res) =>
  res.json(await billing.verifyAuthorization(req.valid.params.code)),
);
