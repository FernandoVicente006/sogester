import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api.js'
import { ROLE_LABELS, useAuth } from '../auth.jsx'

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
  const isAdmin = ['SUPER_ADMIN', 'ADMIN_ENTIDADE'].includes(user.role)
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Sogester</h1>
        <nav>
          <NavLink to="/processos">
            Processos {unread > 0 && <span className="count" title="Mensagens por ler">{unread}</span>}
          </NavLink>
          <NavLink to="/transitarios">{user.role === 'TRANSITARIO' ? 'O meu perfil' : 'Transitários'}</NavLink>
          {isAdmin && <NavLink to="/funcionarios">Funcionários</NavLink>}
          {user.role === 'SUPER_ADMIN' && <NavLink to="/entidades">Entidades</NavLink>}
        </nav>
        <div className="me">
          <strong>{user.name}</strong>
          <span className="muted">{ROLE_LABELS[user.role]}</span>
          <button className="link" onClick={logout}>
            Terminar sessão
          </button>
        </div>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
