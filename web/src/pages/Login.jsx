import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBox, Field } from '../components/ui.jsx'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    <form className="card auth" onSubmit={submit}>
      <h1>Sogester</h1>
      <p className="muted">Gestão de processos portuários</p>
      <Field label="E-mail">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </Field>
      <Field label="Palavra-passe">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <ErrorBox message={error} />
      <button className="primary" disabled={busy}>
        {busy ? 'A entrar…' : 'Entrar'}
      </button>
      <p className="muted small">
        Primeira utilização de uma entidade? <Link to="/setup">Inicializar administrador</Link>
      </p>
    </form>
  )
}
