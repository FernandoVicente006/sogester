import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api.js'
import { ROLE_LABELS, useAuth } from '../auth.jsx'
import { ErrorBox, Field, Icon, Modal, PageHeader } from '../components/ui.jsx'

const ASSIGNABLE = ['LOJA', 'CADASTRO', 'FINANCAS', 'CHEFE_COMERCIAL', 'PORTARIA']

export default function Staff() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [entities, setEntities] = useState([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsers((await api('GET', '/users')).users)
      setError('')
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    load()
    if (user.role === 'SUPER_ADMIN') api('GET', '/entities').then((r) => setEntities(r.entities))
  }, [load, user.role])

  async function patch(u, body) {
    try {
      await api('PATCH', `/users/${u.id}`, { body })
      load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const entityName = (id) => entities.find((e) => e.id === id)?.name ?? ''
  const manageable = (u) => u.id !== user.id && (user.role === 'SUPER_ADMIN' || u.role !== 'ADMIN_ENTIDADE')

  return (
    <>
      <PageHeader title="Funcionários" subtitle="Atribua a cada pessoa o perfil da sua etapa.">
        <button className="primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> Novo funcionário
        </button>
      </PageHeader>
      <ErrorBox message={error} />
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            {user.role === 'SUPER_ADMIN' && <th>Entidade</th>}
            <th>Perfil</th>
            <th>Estado</th>
            {user.role === 'SUPER_ADMIN' && <th>Gere terminais</th>}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              {user.role === 'SUPER_ADMIN' && <td>{entityName(u.entityId)}</td>}
              <td>
                {manageable(u) && ASSIGNABLE.includes(u.role) ? (
                  <select value={u.role} onChange={(e) => patch(u, { role: e.target.value })}>
                    {ASSIGNABLE.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  ROLE_LABELS[u.role]
                )}
              </td>
              <td>
                {manageable(u) ? (
                  <button onClick={() => patch(u, { active: !u.active })}>{u.active ? 'Desativar' : 'Ativar'}</button>
                ) : (
                  'Ativo'
                )}
              </td>
              {user.role === 'SUPER_ADMIN' && (
                <td>
                  {u.role !== 'SUPER_ADMIN' && (
                    <label className="check">
                      <input type="checkbox" checked={u.canManageTerminals} onChange={(e) => patch(u, { canManageTerminals: e.target.checked })} />
                      {u.canManageTerminals ? 'Sim' : 'Não'}
                    </label>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {creating && (
        <CreateUser
          entities={entities}
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

function CreateUser({ entities, onClose, onDone }) {
  const { user } = useAuth()
  const isSuper = user.role === 'SUPER_ADMIN'
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'LOJA', entityId: '' })
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const roles = isSuper ? ['ADMIN_ENTIDADE', ...ASSIGNABLE] : ASSIGNABLE

  async function submit(e) {
    e.preventDefault()
    try {
      const body = { ...form, entityId: isSuper ? Number(form.entityId) : undefined }
      await api('POST', '/users', { body })
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Modal title="Novo funcionário" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {isSuper && (
          <Field label="Entidade">
            <select value={form.entityId} onChange={set('entityId')} required>
              <option value="" disabled>
                Escolher…
              </option>
              {entities.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Nome">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="E-mail">
          <input type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Palavra-passe inicial (mín. 8)">
          <input type="password" value={form.password} onChange={set('password')} minLength={8} required />
        </Field>
        <Field label="Perfil">
          <select value={form.role} onChange={set('role')}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox message={error} />
        <button className="primary">Criar</button>
      </form>
    </Modal>
  )
}
