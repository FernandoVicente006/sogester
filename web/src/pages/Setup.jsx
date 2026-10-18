import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { ErrorBox, Field } from '../components/ui.jsx'

/** Inicialização do administrador (diretor-geral): escolhe o terminal, que fica vinculado em definitivo. */
export default function Setup() {
  const navigate = useNavigate()
  const [entities, setEntities] = useState([])
  const [form, setForm] = useState({ entityCode: '', name: '', email: '', password: '', setupToken: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    api('GET', '/entities/public')
      .then((r) => {
        setEntities(r.entities)
        setForm((f) => ({ ...f, entityCode: r.entities[0]?.code ?? '' }))
      })
      .catch((err) => setError(errorText(err)))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { setupToken, ...body } = form
      await api('POST', '/setup/entity-admin', { body, headers: { 'X-Setup-Token': setupToken } })
      navigate('/login')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <h1>Inicializar entidade</h1>
      <p className="muted">
        O administrador fica vinculado em definitivo ao terminal escolhido e não poderá ver dados de outras entidades.
      </p>
      <Field label="Terminal">
        <select value={form.entityCode} onChange={set('entityCode')} required>
          {entities.map((en) => (
            <option key={en.id} value={en.code}>
              {en.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nome (diretor-geral)">
        <input value={form.name} onChange={set('name')} required />
      </Field>
      <Field label="E-mail">
        <input type="email" value={form.email} onChange={set('email')} required />
      </Field>
      <Field label="Palavra-passe (mín. 8)">
        <input type="password" value={form.password} onChange={set('password')} minLength={8} required />
      </Field>
      <Field label="Token de inicialização">
        <input type="password" value={form.setupToken} onChange={set('setupToken')} required />
      </Field>
      <ErrorBox message={error} />
      <button className="primary" disabled={busy}>
        {busy ? 'A criar…' : 'Criar administrador'}
      </button>
      <p className="muted small">
        <Link to="/login">Voltar ao início de sessão</Link>
      </p>
    </form>
  )
}
