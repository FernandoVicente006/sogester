import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../api.js'
import { ErrorBox, PageHeader } from '../components/ui.jsx'

export default function Entities() {
  const [entities, setEntities] = useState([])
  const [error, setError] = useState('')

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
      <PageHeader title="Entidades" subtitle="O MVP funciona apenas em Cabinda; ative Soyo e Luanda quando estiverem prontas." />
      <ErrorBox message={error} />
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Entidade</th>
            <th>Localização</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((en) => (
            <tr key={en.id}>
              <td>{en.name}</td>
              <td>{en.location}</td>
              <td>
                <button onClick={() => toggle(en)}>{en.active ? 'Desativar' : 'Ativar'}</button>{' '}
                <span className="muted">{en.active ? 'Ativa' : 'Inativa'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  )
}
