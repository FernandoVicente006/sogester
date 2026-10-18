import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Setup from './pages/Setup.jsx'
import Forwarders from './pages/Forwarders.jsx'
import ForwarderDetail from './pages/ForwarderDetail.jsx'
import Staff from './pages/Staff.jsx'
import Entities from './pages/Entities.jsx'
import Processes from './pages/Processes.jsx'
import NewProcess from './pages/NewProcess.jsx'
import ProcessDetail from './pages/ProcessDetail.jsx'
import Verify from './pages/Verify.jsx'

/** Página inicial: a fila de processos (cada perfil já vê só o que lhe cabe). */
const Home = () => <Navigate to="/processos" replace />

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
      <Route path="/verificar/:code" element={<Verify />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Home />} />
        <Route path="transitarios" element={<Forwarders />} />
        <Route path="transitarios/:id" element={<ForwarderDetail />} />
        <Route path="processos" element={<Processes />} />
        <Route
          path="processos/novo"
          element={
            <Protected roles={['TRANSITARIO']}>
              <NewProcess />
            </Protected>
          }
        />
        <Route path="processos/:id" element={<ProcessDetail />} />
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
