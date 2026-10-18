import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Cria a base (se não existir) e aplica as migrações SQL pendentes, por ordem de nome. */
export async function migrate({ log = console.log } = {}) {
  const { database, ...conn } = config.db;
  const root = await mysql.createConnection({ ...conn, multipleStatements: true, charset: 'utf8mb4' });
  try {
    await root.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await root.query(`USE \`${database}\``);
    await root.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(190) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);

    const [done] = await root.query('SELECT name FROM schema_migrations');
    const applied = new Set(done.map((r) => r.name));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      log(`Aplicando ${file}`);
      await root.query(await fs.readFile(path.join(dir, file), 'utf8'));
      await root.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    }
  } finally {
    await root.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
