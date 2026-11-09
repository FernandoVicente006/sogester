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

  // Destino depois de entrar (ex.: a portaria vinda do QR Code). Só caminhos internos.
  const back = new URLSearchParams(window.location.search).get('voltar')
  const target = back && back.startsWith('/') && !back.startsWith('//') ? back : '/'

  if (user) return <Navigate to={target} replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate(target)
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
            Primeira instalação? <Link to="/setup">Inicializar a plataforma</Link>
          </p>
        )}
      </form>
    </AuthShell>
  )
}
