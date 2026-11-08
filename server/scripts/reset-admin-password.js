// Recuperação da palavra-passe do administrador geral, só com acesso ao servidor.
// Não cria nenhum administrador novo nem reabre o setup: apenas troca a palavra-passe do que já existe.
// Uso (no servidor):  npm run admin:reset-password
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { pool, queryOne } from '../src/db/pool.js';

const rl = readline.createInterface({ input: stdin, output: stdout });
try {
  const admin = await queryOne("SELECT id, name, email FROM users WHERE role = 'SUPER_ADMIN' ORDER BY id LIMIT 1");
  if (!admin) throw new Error('Não existe administrador geral. Faça o setup inicial.');
  stdout.write(`Administrador geral: ${admin.name} <${admin.email}>\n`);

  const password = await rl.question('Nova palavra-passe (mín. 8 caracteres, com letras e números): ');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('Palavra-passe fraca.');
  if ((await rl.question('Repita a palavra-passe: ')) !== password) throw new Error('As palavras-passe não coincidem.');

  await pool.query('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', [await bcrypt.hash(password, 10), admin.id]);
  await pool.query(
    "INSERT INTO audit_log (user_id, action, target_type, target_id, details) VALUES (?, 'SUPER_ADMIN_PASSWORD_RESET', 'user', ?, ?)",
    [admin.id, admin.id, JSON.stringify({ via: 'consola do servidor' })],
  );
  stdout.write('Palavra-passe alterada. Já pode entrar.\n');
} catch (err) {
  stdout.write(`Erro: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
  await pool.end();
}
