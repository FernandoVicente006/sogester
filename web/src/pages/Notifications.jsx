import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { NOTIFICATION_ICONS } from '../components/NotificationBell.jsx'
import { Empty, ErrorBox, Icon, PageHeader, formatDate } from '../components/ui.jsx'

export default function Notifications() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [emailOn, setEmailOn] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await api('GET', `/notifications?limit=100${unreadOnly ? '&unread=1' : ''}`))
    } catch (err) {
      setError(errorText(err))
    }
  }, [unreadOnly])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    api('GET', '/auth/me')
      .then((r) => setEmailOn(r.user.emailNotifications))
      .catch(() => {})
  }, [])

  async function toggleEmail(e) {
    const value = e.target.checked
    setEmailOn(value)
    try {
      await api('PATCH', '/auth/preferences', { body: { emailNotifications: value } })
    } catch (err) {
      setEmailOn(!value)
      setError(errorText(err))
    }
  }

  async function open(n) {
    if (!n.readAt) await api('POST', `/notifications/${n.id}/read`).catch(() => {})
    window.dispatchEvent(new Event('sogester:unread'))
    if (n.processId) navigate(`/processos/${n.processId}`)
    else load()
  }

  async function readAll() {
    await api('POST', '/notifications/read-all')
    window.dispatchEvent(new Event('sogester:unread'))
    load()
  }

  return (
    <>
      <PageHeader title="Notificações" subtitle="Avisos sobre os seus processos, dentro da plataforma e por e-mail.">
        <button onClick={readAll} disabled={!data?.unread}>
          <Icon name="check" /> Marcar todas como lidas
        </button>
      </PageHeader>
      <ErrorBox message={error} />

      <section className="card">
        <h3>
          <Icon name="mail" /> E-mail
        </h3>
        <label className="check">
          <input type="checkbox" checked={emailOn} onChange={toggleEmail} />
          Receber notificações por e-mail
        </label>
        {data && !data.emailEnabled && (
          <p className="muted small" style={{ margin: '.6rem 0 0' }}>
            O envio de e-mail ainda não está configurado no servidor: por agora recebe os avisos apenas aqui.
          </p>
        )}
      </section>

      <div className="filters">
        <label className="check">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Só por ler
        </label>
      </div>

      <div className="table-wrap">
        <ul className="notif-list">
          {data?.notifications.map((n) => (
            <li key={n.id}>
              <button className={n.readAt ? 'notif' : 'notif unread'} onClick={() => open(n)}>
                <span className="notif-icon">
                  <Icon name={NOTIFICATION_ICONS[n.type] ?? 'clipboard'} />
                </span>
                <span className="notif-text">
                  <strong>{n.title}</strong>
                  {n.body && <span>{n.body}</span>}
                </span>
                <span className="muted small notif-date">{formatDate(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
        {data && !data.notifications.length && <Empty icon="bell">Sem notificações.</Empty>}
      </div>
    </>
  )
}
