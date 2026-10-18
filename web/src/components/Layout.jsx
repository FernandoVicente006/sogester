import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api.js'
import { ROLE_LABELS, useAuth } from '../auth.jsx'
import NotificationBell from './NotificationBell.jsx'
import { Avatar, Brand, Icon } from './ui.jsx'

/** Total de mensagens por ler; atualiza periodicamente e quando o chat marca mensagens como lidas. */
function useUnread() {
  const [total, setTotal] = useState(0)
  useEffect(() => {
    const refresh = () =>
      document.visibilityState === 'visible' &&
      api('GET', '/messages/unread')
        .then((r) => setTotal(r.total))
        .catch(() => {})
    refresh()
    const timer = setInterval(refresh, 15000)
    window.addEventListener('sogester:unread', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('sogester:unread', refresh)
    }
  }, [])
  return total
}

export default function Layout() {
  const { user, logout } = useAuth()
  const unread = useUnread()
  const [open, setOpen] = useState(false)
  const [terminal, setTerminal] = useState('')
  const location = useLocation()
  const isAdmin = ['SUPER_ADMIN', 'ADMIN_ENTIDADE'].includes(user.role)

  useEffect(() => setOpen(false), [location.pathname])

  useEffect(() => {
    if (!user.entityId) return
    api('GET', '/entities')
      .then((r) => setTerminal(r.entities.find((e) => e.id === user.entityId)?.name ?? ''))
      .catch(() => {})
  }, [user.entityId])

  return (
    <div className="shell">
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <Brand />
        {terminal && (
          <div className="terminal-chip">
            <span>Terminal</span>
            {terminal}
          </div>
        )}
        <nav aria-label="Principal">
          <NavLink to="/painel">
            <Icon name="dashboard" /> Painel
          </NavLink>
          <NavLink to="/processos">
            <Icon name="clipboard" /> Processos
            {unread > 0 && (
              <span className="count" title="Mensagens por ler">
                {unread}
              </span>
            )}
          </NavLink>
          {user.role !== 'TRANSITARIO' && (
            <NavLink to="/relatorios">
              <Icon name="chart" /> Relatórios
            </NavLink>
          )}
          <NavLink to="/transitarios">
            <Icon name="truck" /> {user.role === 'TRANSITARIO' ? 'O meu perfil' : 'Transitários'}
          </NavLink>
          {isAdmin && (
            <NavLink to="/funcionarios">
              <Icon name="users" /> Funcionários
            </NavLink>
          )}
          {user.role === 'SUPER_ADMIN' && (
            <NavLink to="/entidades">
              <Icon name="building" /> Entidades
            </NavLink>
          )}
        </nav>
        <div className="me">
          <Avatar name={user.name} />
          <div className="me-info">
            <strong>{user.name}</strong>
            <span>{ROLE_LABELS[user.role]}</span>
          </div>
          <button className="icon-btn" onClick={logout} title="Terminar sessão" aria-label="Terminar sessão">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <button className="menu-toggle" onClick={() => setOpen((o) => !o)} aria-label="Abrir menu" aria-expanded={open}>
            <Icon name="menu" />
          </button>
          <NotificationBell />
        </div>
        <Outlet />
      </main>
    </div>
  )
}
