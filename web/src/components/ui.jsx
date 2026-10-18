import { useEffect } from 'react'

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
  AUTORIZACAO_EMITIDA: 'Autorização emitida',
  PAGAMENTO_PENDENTE: 'Pagamento pendente',
  PAGAMENTO_SUBMETIDO: 'Pagamento submetido',
  PAGAMENTO_CONFIRMADO: 'Pagamento confirmado',
  CONCLUIDO: 'Concluído',
}

export const Badge = ({ status }) => <span className={`badge badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>

export const ProcessBadge = ({ status }) => (
  <span className={`badge pbadge-${status}`}>{PROCESS_STATUS_LABELS[status] ?? status}</span>
)

export function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Fechar">
            ✕
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

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : ''
