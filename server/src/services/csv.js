// CSV para Excel em português: separador ";", BOM UTF-8, decimais com vírgula.
const pad = (n) => String(n).padStart(2, '0');

export const formatDateTime = (d) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';

function cell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  let text = String(value);
  // Proteção contra injeção de fórmulas ao abrir no Excel/LibreOffice.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `columns`: [{ label, value: (row) => any }] */
export function toCsv(columns, rows) {
  const header = columns.map((c) => cell(c.label)).join(';');
  const lines = rows.map((r) => columns.map((c) => cell(c.value(r))).join(';'));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}
