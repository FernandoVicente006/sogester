import { NavLink, Outlet } from 'react-router-dom'
import { ROLE_LABELS, useAuth } from '../auth.jsx'

export default function Layout() {
  const { user, logout } = useAuth()
  const isAdmin = ['SUPER_ADMIN', 'ADMIN_ENTIDADE'].includes(user.role)
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Sogester</h1>
        <nav>
          <NavLink to="/" end>
            Transitários
          </NavLink>
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
