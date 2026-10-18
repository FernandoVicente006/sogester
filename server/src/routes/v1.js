import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { CARGO_PRIORITIES, DOCUMENT_KINDS, VOLUME_TYPES, cargoCatalog } from '../cargo.js';
import { badRequest } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../roles.js';
import * as auth from '../services/auth.js';
import * as entities from '../services/entities.js';
import * as forwarders from '../services/forwarders.js';
import * as processes from '../services/processes.js';
import * as setup from '../services/setup.js';
import * as users from '../services/users.js';

export const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

const { SUPER_ADMIN, ADMIN_ENTIDADE, CADASTRO, LOJA, FATURACAO, TRANSITARIO } = ROLES;
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
  setup: z.object({ entityCode: z.string().trim().toUpperCase().min(1).max(20), name: text(120), email, password }),
  entityPatch: z.object({ name: text(120).optional(), active: z.boolean().optional() }),
  userCreate: z.object({
    name: text(120),
    email,
    password,
    role: z.enum([ADMIN_ENTIDADE, LOJA, CADASTRO, FATURACAO]),
    entityId: id.optional(),
  }),
  userPatch: z.object({
    name: text(120).optional(),
    role: z.enum([ADMIN_ENTIDADE, LOJA, CADASTRO, FATURACAO]).optional(),
    active: z.boolean().optional(),
    password: password.optional(),
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
    quantity: z.number().positive().max(1e9).optional(),
    weightKg: z.number().positive().max(1e9).optional(),
    vehicleBrand: text(80).optional(),
    vehicleModel: text(80).optional(),
    container: z
      .object({
        plate: text(30),
        type: text(60),
        volume: z.number().positive().max(1e6),
        weightKg: z.number().positive().max(1e9),
      })
      .optional(),
    urgencyRequested: z.boolean().optional(),
    urgencyReason: z.string().trim().max(500).optional(),
  }),
  processList: z.object({
    status: z.string().trim().max(30).optional(),
    q: z.string().trim().max(100).optional(),
    entityId: id.optional(),
    forwarderId: id.optional(),
  }),
  processTransition: z.object({
    status: z.enum(['EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'REJEITADO']),
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

// Inicialização do administrador de cada entidade (protegida por token de setup)
v1.post('/setup/entity-admin', loginLimiter, validate({ body: schemas.setup }), async (req, res) => {
  const user = await setup.createEntityAdmin(req.get('x-setup-token'), req.valid.body);
  res.status(201).json({ user });
});

// Entidades: lista pública das ativas (ecrã de inicialização); gestão só para super admin
v1.get('/entities/public', async (_req, res) => res.json({ entities: await entities.listEntities({ onlyActive: true }) }));
v1.get('/entities', authenticate, async (req, res) => {
  const all = await entities.listEntities();
  res.json({ entities: req.user.role === SUPER_ADMIN ? all : all.filter((e) => e.id === req.user.entityId) });
});
v1.patch(
  '/entities/:id',
  authenticate,
  requireRole(SUPER_ADMIN),
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
      if (!req.file || !Object.hasOwn(DOCUMENT_KINDS, kind)) {
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
