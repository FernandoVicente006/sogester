import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import AuthShell from '../components/AuthShell.jsx'
import { ErrorBox, Field } from '../components/ui.jsx'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [canInitialize, setCanInitialize] = useState(false)

  useEffect(() => {
    api('GET', '/setup/status')
      .then((r) => setCanInitialize(r.available))
      .catch(() => setCanInitialize(false))
  }, [])

  if (user) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <form className="auth" onSubmit={submit}>
        <div>
          <h1>Iniciar sessão</h1>
          <p className="muted">Aceda ao portal de processos portuários.</p>
        </div>
        <Field label="E-mail">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </Field>
        <Field label="Palavra-passe">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorBox message={error} />
        <button className="primary" disabled={busy}>
          {busy ? 'A entrar…' : 'Entrar'}
        </button>
        {canInitialize && (
          <p className="muted small">
            Primeira utilização de um terminal? <Link to="/setup">Inicializar administrador</Link>
          </p>
        )}
      </form>
    </AuthShell>
  )
}
