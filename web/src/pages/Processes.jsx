import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Empty, ErrorBox, Icon, PRIORITY_LABELS, PROCESS_STATUS_LABELS, PageHeader, ProcessBadge, SearchInput, formatDate } from '../components/ui.jsx'

const PAYMENT_QUEUE = 'PAGAMENTO_SUBMETIDO,PAGAMENTO_CONFIRMADO,PAGAMENTO_PENDENTE'

const CLOSED = ['CONCLUIDO', 'REJEITADO', 'CANCELADO']

/** Lista atual (por defeito) ou Arquivados: processos concluídos, rejeitados e cancelados. */
export default function Processes({ archived = false }) {
  const { user } = useAuth()
  const isForwarder = user.role === 'TRANSITARIO'
  const [params, setParams] = useSearchParams()
  const isFinance = user.role === 'FINANCAS'
  const status = params.get('status') ?? (isFinance && !archived ? PAYMENT_QUEUE : '')
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams()
      if (q) query.set('q', q)
      if (status) query.set('status', status)
      if (archived) query.set('archived', '1')
      setItems((await api('GET', `/processes?${query}`)).processes)
      setError('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoaded(true)
    }
  }, [q, status, archived])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <PageHeader
        title={archived ? 'Arquivados' : isForwarder ? 'Os meus processos' : isFinance ? 'Fila de pagamentos' : 'Fila de processos'}
        subtitle={
          archived
            ? 'Processos concluídos, rejeitados e cancelados. Ficam guardados para consulta.'
            : isForwarder
              ? 'Processos em curso. Os terminados passam para os Arquivados.'
              : isFinance
                ? 'Comprovativos por validar, recibos por enviar e pagamentos pendentes.'
                : 'Ordem: urgência pedida, tipo de carga e ordem de chegada.'
        }
      >
        {isForwarder && !archived && (
          <Link to="/processos/novo" className="button primary">
            <Icon name="plus" /> Novo processo
          </Link>
        )}
      </PageHeader>

      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Pesquisar referência, cliente, documento ou transitário" />
        <select
          value={status}
          onChange={(e) => setParams(e.target.value || (isFinance && !archived) ? { status: e.target.value } : {})}
          aria-label="Filtrar por estado"
        >
          {isFinance && !archived && <option value={PAYMENT_QUEUE}>Fila de pagamentos</option>}
          <option value="">Todos os estados</option>
          {Object.entries(PROCESS_STATUS_LABELS)
            .filter(([k]) => CLOSED.includes(k) === archived)
            .map(([k, v]) => (
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
              <th>{archived ? 'Arquivado' : 'Submetido'}</th>
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
                  {p.paymentOverdue && <span className="tag urgent">Em incumprimento</span>}
                  {p.urgencyRequested && <span className="tag urgent">Urgente</span>}
                  <span className={`tag prio-${p.cargoPriority}`}>{PRIORITY_LABELS[p.cargoPriority]}</span>
                </td>
                <td>
                  <ProcessBadge status={p.status} />
                </td>
                <td className="muted">{formatDate(archived ? p.archivedAt : p.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loaded && !items.length && <Empty icon="clipboard">{archived ? 'Ainda não há processos arquivados.' : 'Sem processos para os filtros escolhidos.'}</Empty>}
      </div>
    </>
  )
}
