import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

function required(name, devDefault) {
  const value = process.env[name] ?? (isProd ? undefined : devDefault);
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente em falta: ${name}`);
  }
  return value;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3100),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // Token exigido para inicializar o administrador de cada entidade. Vazio = endpoint desativado.
  setupToken: process.env.SETUP_TOKEN ?? (isProd ? '' : 'dev-setup-token'),
  // Chave que assina os códigos de autorização digital (independente do JWT para poder rodar este sem invalidar autorizações).
  authorizationSecret: required('AUTHORIZATION_SECRET', 'dev-only-authorization-secret'),
  // Dias que o transitário tem para liquidar após uma saída antecipada (carga perecível).
  commitmentDays: Number(process.env.PAYMENT_COMMITMENT_DAYS ?? 3),
  // URL pública do frontend (links nos e-mails).
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  // E-mail por SMTP; sem SMTP_HOST as notificações ficam só dentro da plataforma.
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'Sogester <no-reply@sogester.local>',
    maxAttempts: Number(process.env.MAIL_MAX_ATTEMPTS ?? 5),
  },
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'sogester',
  },
  seed: {
    superAdminEmail: process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@sogester.local',
    superAdminPassword: required('SEED_SUPERADMIN_PASSWORD', 'Admin@12345'),
  },
};
