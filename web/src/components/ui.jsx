import { useEffect } from 'react'

// ---- ícones (traço, estilo Lucide) ----------------------------------------------------------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
}

export const Icon = ({ name, ...props }) => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }} {...props} />
)

/** Marca provisória em SVG (já não usada na navegação; mantida como alternativa). */
export function BrandMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Sogester">
      <rect width="32" height="32" rx="8" fill="#046bd2" />
      <g fill="#fff">
        <rect x="6" y="8" width="9" height="7" rx="1.2" />
        <rect x="17" y="8" width="9" height="7" rx="1.2" opacity=".75" />
        <rect x="11.5" y="17" width="9" height="7" rx="1.2" fill="#f5a623" />
      </g>
    </svg>
  )
}

/** Logótipo oficial (versão negativa, para fundos escuros), recortado à área útil por CSS. */
export const Brand = ({ width = 132 }) => (
  <div className="brand">
    <img className="brand-logo" src="/logo-sogester.png" alt="Sogester — Sociedade Gestora de Terminais" style={{ width }} />
  </div>
)

export const Avatar = ({ name }) => (
  <span className="avatar" aria-hidden="true">
    {name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('')}
  </span>
)

// ---- estados ---------------------------------------------------------------------------------
export const STATUS_LABELS = {
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
  SUSPENSO: 'Suspenso',
}

export const PROCESS_STATUS_LABELS = {
  SUBMETIDO: 'Submetido',
  EM_ANALISE: 'Em análise',
  REJEITADO: 'Rejeitado',
  DOCUMENTOS_PENDENTES: 'Documentos pendentes',
  DOCUMENTOS_SUBMETIDOS: 'Documentos submetidos',
  EM_PROCESSAMENTO_INTERNO: 'Em processamento interno',
  PAGAMENTO_PENDENTE: 'Pendente de pagamento',
  PAGAMENTO_SUBMETIDO: 'Pagamento em análise',
  PAGAMENTO_CONFIRMADO: 'Aguarda recibo',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
}

export const PRIORITY_LABELS = {
  PERECIVEL: 'Perecível',
  CARGA_PERIGOSA: 'Carga perigosa',
  DESCARGA_DIRETA: 'Descarga direta',
  NAO_PRIORITARIO: 'Não prioritário',
}

export const Badge = ({ status }) => <span className={`badge badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>

export const ProcessBadge = ({ status }) => (
  <span className={`badge pbadge-${status}`}>{PROCESS_STATUS_LABELS[status] ?? status}</span>
)

// ---- estrutura -------------------------------------------------------------------------------
export const PageHeader = ({ title, subtitle, children }) => (
  <div className="page-head">
    <div>
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children && <div className="spacer">{children}</div>}
  </div>
)

export const SearchInput = ({ value, onChange, placeholder }) => (
  <div className="search">
    <Icon name="search" />
    <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
  </div>
)

export const Empty = ({ icon = 'inbox', children }) => (
  <div className="empty">
    <Icon name={icon} />
    {children}
  </div>
)

export function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide === 'xl' ? 'modal wide xl' : wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" style={{ color: 'var(--muted)' }} onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
)

export const ErrorBox = ({ message }) =>
  message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null

/** "agora", "há 5 min", "há 3 h" ou a data, para listas de notificações. */
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`
  return formatDate(iso)
}

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : ''
