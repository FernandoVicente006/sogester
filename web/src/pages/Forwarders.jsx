import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Badge, ErrorBox, Field, Modal, STATUS_LABELS } from '../components/ui.jsx'

const MANAGE = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'CADASTRO']

export default function Forwarders() {
  const { user } = useAuth()
  const canManage = MANAGE.includes(user.role)
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // 'create' | 'link' | null

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status) params.set('status', status)
      setItems((await api('GET', `/forwarders?${params}`)).forwarders)
      setError('')
    } catch (err) {
      setError(errorText(err))
    }
  }, [q, status])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <div className="toolbar">
        <h2>Transitários</h2>
        {canManage && user.role !== 'SUPER_ADMIN' && (
          <button onClick={() => setModal('link')}>Vincular por NIF</button>
        )}
        {canManage && (
          <button className="primary" onClick={() => setModal('create')}>
            Novo transitário
          </button>
        )}
      </div>

      <div className="filters">
        <input placeholder="Pesquisar nome, NIF ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        {user.role !== 'TRANSITARIO' && (
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos os estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>

      <ErrorBox message={error} />
      <table>
        <thead>
          <tr>
            <th>Transitário</th>
            <th>NIF</th>
            <th>Contacto</th>
            <th>Terminais</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f) => (
            <tr key={f.id}>
              <td>
                <Link to={`/transitarios/${f.id}`}>{f.name}</Link>
              </td>
              <td>{f.nif}</td>
              <td>{f.email}</td>
              <td className="chips">
                {f.entities.map((en) => (
                  <span key={en.entityId}>
                    {en.entityCode.charAt(0) + en.entityCode.slice(1).toLowerCase()} <Badge status={en.status} />
                  </span>
                ))}
              </td>
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={4} className="muted center">
                Sem transitários.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modal === 'create' && (
        <CreateForwarder
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null)
            load()
          }}
        />
      )}
      {modal === 'link' && (
        <LinkForwarder
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null)
            load()
          }}
        />
      )}
    </>
  )
}

function CreateForwarder({ onClose, onDone }) {
  const { user } = useAuth()
  const [entities, setEntities] = useState([])
  const [form, setForm] = useState({ name: '', nif: '', email: '', phone: '', location: '', entityIds: [] })
  const [account, setAccount] = useState({ enabled: true, name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const acc = (k) => (e) => setAccount((a) => ({ ...a, [k]: e.target.value }))

  useEffect(() => {
    if (user.role === 'SUPER_ADMIN') api('GET', '/entities').then((r) => setEntities(r.entities.filter((en) => en.active)))
  }, [user.role])

  async function submit(e) {
    e.preventDefault()
    setError('')
    const body = { ...form, phone: form.phone || undefined }
    if (user.role !== 'SUPER_ADMIN') delete body.entityIds
    if (account.enabled) body.user = { name: account.name, email: account.email, password: account.password }
    try {
      await api('POST', '/forwarders', { body })
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const toggleEntity = (id) =>
    setForm((f) => ({ ...f, entityIds: f.entityIds.includes(id) ? f.entityIds.filter((x) => x !== id) : [...f.entityIds, id] }))

  return (
    <Modal title="Novo transitário" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Nome da empresa">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <div className="row">
          <Field label="NIF">
            <input value={form.nif} onChange={set('nif')} required />
          </Field>
          <Field label="Telefone">
            <input value={form.phone} onChange={set('phone')} />
          </Field>
        </div>
        <Field label="E-mail">
          <input type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Localização">
          <input value={form.location} onChange={set('location')} required />
        </Field>
        {user.role === 'SUPER_ADMIN' && (
          <fieldset>
            <legend>Terminais</legend>
            {entities.map((en) => (
              <label key={en.id} className="check">
                <input type="checkbox" checked={form.entityIds.includes(en.id)} onChange={() => toggleEntity(en.id)} />
                {en.name}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset>
          <legend>
            <label className="check">
              <input
                type="checkbox"
                checked={account.enabled}
                onChange={(e) => setAccount((a) => ({ ...a, enabled: e.target.checked }))}
              />
              Criar acesso ao portal para o transitário
            </label>
          </legend>
          {account.enabled && (
            <div className="stack">
              <Field label="Nome do utilizador">
                <input value={account.name} onChange={acc('name')} required />
              </Field>
              <Field label="E-mail de acesso">
                <input type="email" value={account.email} onChange={acc('email')} required />
              </Field>
              <Field label="Palavra-passe inicial (mín. 8)">
                <input type="password" value={account.password} onChange={acc('password')} minLength={8} required />
              </Field>
            </div>
          )}
        </fieldset>
        <ErrorBox message={error} />
        <button className="primary">Guardar</button>
      </form>
    </Modal>
  )
}

function LinkForwarder({ onClose, onDone }) {
  const [nif, setNif] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    try {
      await api('POST', '/forwarders/link', { body: { nif } })
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal title="Vincular transitário existente" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <p className="muted">
          Para transitários já registados noutro terminal. Ficam pendentes até validar a documentação.
        </p>
        <Field label="NIF">
          <input value={nif} onChange={(e) => setNif(e.target.value)} required autoFocus />
        </Field>
        <ErrorBox message={error} />
        <button className="primary">Vincular</button>
      </form>
    </Modal>
  )
}
