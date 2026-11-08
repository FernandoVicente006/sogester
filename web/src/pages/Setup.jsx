import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import AuthShell from '../components/AuthShell.jsx'
import { ErrorBox, Field } from '../components/ui.jsx'

/** Inicialização única da plataforma: cria o super administrador da Sogester e fecha para sempre. */
export default function Setup() {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null) // { available }
  const [form, setForm] = useState({ name: '', email: '', password: '', setupToken: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    api('GET', '/setup/status')
      .then(setStatus)
      .catch((err) => setError(errorText(err)))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { setupToken, ...body } = form
      await api('POST', '/setup/super-admin', { body, headers: { 'X-Setup-Token': setupToken } })
      navigate('/login')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (status && !status.available) {
    return (
      <AuthShell>
        <div className="auth">
          <div>
            <h1>Plataforma inicializada</h1>
            <p className="muted">
              A inicialização já foi feita e não volta a abrir. Os terminais e os acessos são criados dentro da plataforma
              pelo administrador geral.
            </p>
          </div>
          <p className="muted small">
            <Link to="/login">Voltar ao início de sessão</Link>
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <form className="auth" onSubmit={submit}>
        <div>
          <h1>Inicializar a plataforma</h1>
          <p className="muted">
            Cria o administrador geral da Sogester. Só pode ser feito uma vez: depois disso esta página fecha para sempre.
          </p>
        </div>
        <Field label="Nome">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="E-mail">
          <input type="email" value={form.email} onChange={set('email')} autoComplete="username" required />
        </Field>
        <Field label="Palavra-passe (mín. 8)">
          <input type="password" value={form.password} onChange={set('password')} minLength={8} autoComplete="new-password" required />
        </Field>
        <Field label="Token de inicialização">
          <input type="password" value={form.setupToken} onChange={set('setupToken')} required />
        </Field>
        <ErrorBox message={error} />
        <button className="primary" disabled={busy || !status}>
          {busy ? 'A criar…' : 'Criar administrador geral'}
        </button>
        <p className="muted small">
          <Link to="/login">Voltar ao início de sessão</Link>
        </p>
      </form>
    </AuthShell>
  )
}
