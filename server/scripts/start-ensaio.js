// Arranca a API do ENSAIO: base de dados e pasta de ficheiros próprias, para testar com dados reais
// sem misturar com os dados de desenvolvimento. Uso: npm run ensaio (pare antes a API normal).
// Os segredos continuam a vir do server/.env; aqui só se escolhem a base e a pasta.
process.env.DB_NAME ||= 'sogester_ensaio';
process.env.UPLOADS_DIR ||= 'uploads-ensaio';

console.log(`ENSAIO — base ${process.env.DB_NAME}, ficheiros em server/${process.env.UPLOADS_DIR}`);
await import('../src/index.js');
