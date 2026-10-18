import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBox, PROCESS_STATUS_LABELS, ProcessBadge, formatDate } from '../components/ui.jsx'

const PRIORITY_LABELS = {
  PERECIVEL: 'Perecível',
  CARGA_PERIGOSA: 'Carga perigosa',
  DESCARGA_DIRETA: 'Descarga direta',
  NAO_PRIORITARIO: 'Não prioritário',
}

export default function Processes() {
  const { user } = useAuth()
  const isForwarder = user.role === 'TRANSITARIO'
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status) params.set('status', status)
      setItems((await api('GET', `/processes?${params}`)).processes)
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
        <h2>{isForwarder ? 'Os meus processos' : 'Fila de processos'}</h2>
        {isForwarder && (
          <Link to="/processos/novo" className="button primary">
            Novo processo
          </Link>
        )}
      </div>
      {!isForwarder && (
        <p className="muted">
          Ordem: urgência pedida, tipo de carga (perecível, perigosa, descarga direta, restantes) e ordem de chegada.
        </p>
      )}
      <div className="filters">
        <input placeholder="Pesquisar referência, cliente, documento ou transitário" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os estados</option>
          {Object.entries(PROCESS_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox message={error} />
      <table>
        <thead>
          <tr>
            <th>Referência</th>
            {!isForwarder && <th>Transitário</th>}
            <th>Cliente</th>
            <th>Carga</th>
            <th>Estado</th>
            <th>Submetido</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/processos/${p.id}`}>{p.reference}</Link>
                {p.unreadMessages > 0 && <span className="count" title="Mensagens por ler">{p.unreadMessages}</span>}
              </td>
              {!isForwarder && <td>{p.forwarderName}</td>}
              <td>{p.client.name}</td>
              <td>
                {p.paymentOverdue && <span className="tag urgent">Pagamento em atraso</span>}
                {p.urgencyRequested && <span className="tag urgent">Urgente</span>}
                <span className={`tag prio-${p.cargoPriority}`}>{PRIORITY_LABELS[p.cargoPriority]}</span>
              </td>
              <td>
                <ProcessBadge status={p.status} />
              </td>
              <td className="muted">{formatDate(p.submittedAt)}</td>
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={6} className="muted center">
                Sem processos.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
