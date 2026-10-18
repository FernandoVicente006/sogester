import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { mailEnabled } from './services/mailer.js';
import { processOutbox, runPaymentChecks } from './services/notifications.js';

await migrate();
await seed();

createApp().listen(config.port, () => {
  console.log(`Sogester API em http://localhost:${config.port}/api/v1`);
  console.log(mailEnabled() ? `E-mail ativo (${config.mail.host})` : 'E-mail desativado (sem SMTP_HOST): notificações só na plataforma');
});

// Tarefas periódicas: envio dos e-mails pendentes (com tentativas) e prazos de pagamento.
const every = (ms, label, fn) => {
  const run = () => fn().catch((err) => console.error(`[${label}]`, err.message));
  run();
  setInterval(run, ms).unref();
};
every(20_000, 'e-mail', processOutbox);
every(15 * 60_000, 'prazos', runPaymentChecks);
