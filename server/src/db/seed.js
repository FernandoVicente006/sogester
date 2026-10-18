import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { pool, queryOne } from './pool.js';

/** Garante a existência do super administrador do sistema (idempotente). */
export async function seed({ log = console.log } = {}) {
  const { superAdminEmail, superAdminPassword } = config.seed;
  const existing = await queryOne('SELECT id FROM users WHERE email = ?', [superAdminEmail]);
  if (existing) {
    log(`Super administrador já existe (${superAdminEmail})`);
    return;
  }
  const hash = await bcrypt.hash(superAdminPassword, 10);
  await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Administrador Geral', ?, ?, 'SUPER_ADMIN')",
    [superAdminEmail, hash],
  );
  log(`Super administrador criado (${superAdminEmail})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => pool.end())
    .then(
      () => process.exit(0),
      (err) => {
        console.error(err);
        process.exit(1);
      },
    );
}
