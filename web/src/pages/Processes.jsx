import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Empty, ErrorBox, Icon, PRIORITY_LABELS, PROCESS_STATUS_LABELS, PageHeader, ProcessBadge, SearchInput, formatDate } from '../components/ui.jsx'

export default function Processes() {
  const { user } = useAuth()
  const isForwarder = user.role === 'TRANSITARIO'
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams()
      if (q) query.set('q', q)
      if (status) query.set('status', status)
      setItems((await api('GET', `/processes?${query}`)).processes)
      setError('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoaded(true)
    }
  }, [q, status])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <PageHeader
        title={isForwarder ? 'Os meus processos' : 'Fila de processos'}
        subtitle={isForwarder ? 'Todos os processos submetidos por si.' : 'Ordem: urgência pedida, tipo de carga e ordem de chegada.'}
      >
        {isForwarder && (
          <Link to="/processos/novo" className="button primary">
            <Icon name="plus" /> Novo processo
          </Link>
        )}
      </PageHeader>

      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Pesquisar referência, cliente, documento ou transitário" />
        <select
          value={status}
          onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos os estados</option>
          {Object.entries(PROCESS_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox message={error} />

      <div className="table-wrap">
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
                  {p.unreadMessages > 0 && (
                    <span className="count" title="Mensagens por ler">
                      {p.unreadMessages}
                    </span>
                  )}
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
          </tbody>
        </table>
        {loaded && !items.length && <Empty icon="clipboard">Sem processos para os filtros escolhidos.</Empty>}
      </div>
    </>
  )
}
