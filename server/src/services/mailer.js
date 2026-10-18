import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transport = null; // (message) => Promise; criado a pedido a partir do SMTP ou injetado nos testes

/** Permite injetar um transporte (testes). `null` repõe o comportamento por configuração. */
export function setMailTransport(fn) {
  transport = fn;
}

export const mailEnabled = () => !!transport || !!config.mail.host;

export async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    const smtp = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
    transport = (message) => smtp.sendMail({ from: config.mail.from, ...message });
  }
  await transport({ to, subject, text, html });
}
