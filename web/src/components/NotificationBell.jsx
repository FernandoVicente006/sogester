import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Icon, timeAgo } from './ui.jsx'

export const NOTIFICATION_ICONS = {
  MESSAGE: 'message',
  PAYMENT_OVERDUE: 'alert',
  PAYMENT_DUE_SOON: 'clock',
  PROCESS_REJECTED: 'x',
  PROCESS_COMPLETED: 'check',
  PAYMENT_CONFIRMED: 'check',
  AUTHORIZATION_ISSUED: 'shield',
  COMMITMENT_SIGNED: 'shield',
  PROFORMA_ISSUED: 'card',
  PROCESS_WITHDRAWN: 'x',
  PROCESS_CANCELLED: 'x',
  CANCELLATION_REQUESTED: 'alert',
  CANCELLATION_APPROVED: 'check',
  CANCELLATION_DENIED: 'x',
  AUTHORIZATION_REVOKED: 'shield',
  DEADLINE_EXTENDED: 'clock',
  PROCESS_REOPENED: 'clipboard',
  PAYMENT_PROOF_SUBMITTED: 'card',
  PAYMENT_PROOF_REJECTED: 'card',
}

/** Sino com lista rápida das últimas notificações; atualiza periodicamente e quando outra parte da app o pede. */
export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ notifications: [], unread: 0 })
  const box = useRef(null)

  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    api('GET', '/notifications?limit=8')
      .then(setData)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15000)
    window.addEventListener('sogester:unread', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('sogester:unread', refresh)
    }
  }, [refresh])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function openItem(n) {
    setOpen(false)
    if (!n.readAt) await api('POST', `/notifications/${n.id}/read`).catch(() => {})
    refresh()
    if (n.processId) navigate(`/processos/${n.processId}`)
  }

  async function readAll() {
    await api('POST', '/notifications/read-all').catch(() => {})
    refresh()
  }

  return (
    <div className="bell" ref={box}>
      <button className="bell-btn" onClick={() => setOpen((o) => !o)} aria-label={`Notificações${data.unread ? `, ${data.unread} por ler` : ''}`} aria-expanded={open}>
        <Icon name="bell" />
        {data.unread > 0 && <span className="bell-count">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notificações">
          <div className="bell-head">
            <strong>Notificações</strong>
            {data.unread > 0 && (
              <button className="link" onClick={readAll}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          <ul>
            {data.notifications.map((n) => (
              <li key={n.id}>
                <button className={n.readAt ? 'notif' : 'notif unread'} onClick={() => openItem(n)}>
                  <span className="notif-icon">
                    <Icon name={NOTIFICATION_ICONS[n.type] ?? 'clipboard'} />
                  </span>
                  <span className="notif-text">
                    <strong>{n.title}</strong>
                    {n.body && <span>{n.body}</span>}
                    <span className="muted small">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!data.notifications.length && <p className="empty">Sem notificações.</p>}
          <Link to="/notificacoes" className="bell-foot" onClick={() => setOpen(false)}>
            Ver todas e preferências
          </Link>
        </div>
      )}
    </div>
  )
}
