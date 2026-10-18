import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Setup from './pages/Setup.jsx'
import Forwarders from './pages/Forwarders.jsx'
import ForwarderDetail from './pages/ForwarderDetail.jsx'
import Staff from './pages/Staff.jsx'
import Entities from './pages/Entities.jsx'

function Protected({ roles, children }) {
  const { user, loading } = useAuth()
  if (loading) return <p className="center muted">A carregar…</p>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Forwarders />} />
        <Route path="transitarios/:id" element={<ForwarderDetail />} />
        <Route
          path="funcionarios"
          element={
            <Protected roles={['SUPER_ADMIN', 'ADMIN_ENTIDADE']}>
              <Staff />
            </Protected>
          }
        />
        <Route
          path="entidades"
          element={
            <Protected roles={['SUPER_ADMIN']}>
              <Entities />
            </Protected>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
