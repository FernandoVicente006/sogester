import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api.js'
import { ErrorBox, Field, Icon, Modal, PageHeader } from '../components/ui.jsx'

/** Terminais da Sogester: só o administrador geral ou quem ele designar os cria e edita. */
export default function Entities() {
  const [entities, setEntities] = useState([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setEntities((await api('GET', '/entities')).entities)
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(en) {
    try {
      await api('PATCH', `/entities/${en.id}`, { body: { active: !en.active } })
      load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <>
      <PageHeader title="Terminais" subtitle="Um terminal novo nasce inativo: crie os acessos e ative-o quando estiver pronto.">
        <button className="primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> Novo terminal
        </button>
      </PageHeader>
      <ErrorBox message={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Terminal</th>
              <th>Localização</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((en) => (
              <tr key={en.id}>
                <td>
                  <code>{en.code}</code>
                </td>
                <td>{en.name}</td>
                <td>{en.location}</td>
                <td>
                  <button onClick={() => toggle(en)}>{en.active ? 'Desativar' : 'Ativar'}</button>{' '}
                  <span className="muted">{en.active ? 'Ativo' : 'Inativo'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && (
        <CreateTerminal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            load()
          }}
        />
      )}
    </>
  )
}

function CreateTerminal({ onClose, onDone }) {
  const [form, setForm] = useState({ code: '', name: '', location: '' })
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    try {
      await api('POST', '/entities', { body: form })
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal title="Novo terminal" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Código (ex.: LOBITO)">
          <input value={form.code} onChange={set('code')} pattern="[A-Za-z0-9_\-]{2,20}" required autoFocus />
        </Field>
        <Field label="Nome">
          <input value={form.name} onChange={set('name')} placeholder="Sogester Lobito" required />
        </Field>
        <Field label="Localização">
          <input value={form.location} onChange={set('location')} required />
        </Field>
        <ErrorBox message={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            Voltar
          </button>
          <button className="primary">Criar terminal</button>
        </div>
      </form>
    </Modal>
  )
}
