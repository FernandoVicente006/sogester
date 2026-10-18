import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Badge, ErrorBox, Field, Icon } from '../components/ui.jsx'

const MANAGE = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'CADASTRO']

export default function ForwarderDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [f, setF] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const canManage = MANAGE.includes(user.role)
  const canEdit = canManage || user.role === 'TRANSITARIO'

  const apply = useCallback((forwarder) => {
    setF(forwarder)
    setForm({ name: forwarder.name, email: forwarder.email, phone: forwarder.phone ?? '', location: forwarder.location })
  }, [])

  useEffect(() => {
    api('GET', `/forwarders/${id}`)
      .then((r) => apply(r.forwarder))
      .catch((err) => setError(errorText(err)))
  }, [id, apply])

  async function run(fn) {
    setError('')
    setSaved(false)
    try {
      apply((await fn()).forwarder)
      setSaved(true)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const save = (e) => {
    e.preventDefault()
    run(() => api('PATCH', `/forwarders/${id}`, { body: { ...form, phone: form.phone || undefined } }))
  }

  const uploadLogo = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const data = new FormData()
    data.append('logo', file)
    run(() => api('POST', `/forwarders/${id}/logo`, { form: data }))
  }

  const review = (entityId, status) => {
    let notes
    if (status === 'REJEITADO' || status === 'SUSPENSO') {
      notes = window.prompt('Motivo (obrigatório):')
      if (!notes) return
    }
    run(() => api('PUT', `/forwarders/${id}/entities/${entityId}`, { body: { status, notes } }))
  }

  if (!f) return error ? <ErrorBox message={error} /> : <p className="muted">A carregar…</p>

  return (
    <>
      <Link to="/transitarios" className="crumb">
        <Icon name="back" /> Transitários
      </Link>
      <div className="process-head">
        {f.logoPath && <img className="logo" src={`/uploads/${f.logoPath}`} alt={`Logótipo de ${f.name}`} />}
        <h2>{f.name}</h2>
        <span className="muted">NIF {f.nif}</span>
      </div>
      <ErrorBox message={error} />
      {saved && <p className="ok">Guardado.</p>}

      <section className="card">
        <h3>Dados</h3>
        <form onSubmit={save} className="stack">
          <div className="row">
            <Field label="Nome">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canEdit} />
            </Field>
            <Field label="NIF">
              <input value={f.nif} disabled />
            </Field>
          </div>
          <div className="row">
            <Field label="E-mail">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!canEdit} />
            </Field>
            <Field label="Telefone">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canEdit} />
            </Field>
          </div>
          <Field label="Localização">
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} disabled={!canEdit} />
          </Field>
          {canEdit && (
            <div className="row">
              <Field label="Logótipo (PNG, JPG ou WebP, até 2 MB)">
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} />
              </Field>
              <button className="primary self-end">Guardar</button>
            </div>
          )}
        </form>
      </section>

      <section className="card">
        <h3>Terminais</h3>
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Terminal</th>
              <th>Estado</th>
              <th>Notas</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {f.entities.map((en) => (
              <tr key={en.entityId}>
                <td>{en.entityName}</td>
                <td>
                  <Badge status={en.status} />
                </td>
                <td className="muted">{en.notes}</td>
                {canManage && (
                  <td className="actions">
                    {en.status !== 'APROVADO' && <button onClick={() => review(en.entityId, 'APROVADO')}>Aprovar</button>}
                    {en.status === 'PENDENTE' && <button onClick={() => review(en.entityId, 'REJEITADO')}>Rejeitar</button>}
                    {en.status === 'APROVADO' && <button onClick={() => review(en.entityId, 'SUSPENSO')}>Suspender</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </>
  )
}
