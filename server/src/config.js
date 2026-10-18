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
