import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Empty, ErrorBox, Icon, PRIORITY_LABELS, PageHeader, ProcessBadge, formatDate } from '../components/ui.jsx'

const Kpi = ({ icon, tone = '', value, label, to }) => {
  const body = (
    <>
      <span className="kpi-icon">
        <Icon name={icon} />
      </span>
      <div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
      </div>
    </>
  )
  return to ? (
    <Link to={to} className={`kpi ${tone}`}>
      {body}
    </Link>
  ) : (
    <div className={`kpi ${tone}`}>{body}</div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const isForwarder = user.role === 'TRANSITARIO'
  const [stats, setStats] = useState(null)
  const [queue, setQueue] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api('GET', '/processes/stats'), api('GET', '/processes')])
      .then(([s, p]) => {
        setStats(s.stats)
        setQueue(p.processes.filter((x) => !['CONCLUIDO', 'REJEITADO', 'CANCELADO'].includes(x.status)).slice(0, 6))
      })
      .catch((err) => setError(errorText(err)))
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 19 ? 'Boa tarde' : 'Boa noite'

  return (
    <>
      <PageHeader title={`${greeting}, ${user.name.split(' ')[0]}`} subtitle={isForwarder ? 'Acompanhe os seus processos nos terminais da Sogester.' : 'Resumo da operação e fila de processos.'}>
        {isForwarder && (
          <Link to="/processos/novo" className="button primary">
            <Icon name="plus" /> Novo processo
          </Link>
        )}
      </PageHeader>
      <ErrorBox message={error} />

      {stats && (
        <div className="kpis">
          <Kpi icon="clipboard" value={stats.active} label="Processos em curso" to="/processos" />
          {!isForwarder && <Kpi icon="file" tone="amber" value={stats.awaitingReview} label="Para analisar" to="/processos?status=SUBMETIDO" />}
          {isForwarder && <Kpi icon="file" tone="amber" value={stats.awaitingDocuments} label="Documentos a enviar" to="/processos?status=DOCUMENTOS_PENDENTES" />}
          <Kpi icon="card" tone="amber" value={isForwarder ? stats.awaitingPayment : stats.awaitingPaymentValidation} label={isForwarder ? 'Pagamentos pendentes' : 'Comprovativos a validar'} to={isForwarder ? '/processos?status=PAGAMENTO_PENDENTE' : '/processos?status=PAGAMENTO_SUBMETIDO'} />
          <Kpi icon="zap" tone="red" value={stats.urgent} label="Urgências pedidas" />
          <Kpi icon="alert" tone="red" value={stats.overdue} label="Pagamentos em atraso" />
          <Kpi icon="check" tone="green" value={stats.completed} label="Concluídos" to="/processos?status=CONCLUIDO" />
        </div>
      )}

      <div className="page-head">
        <div>
          <h3 style={{ margin: 0 }}>{isForwarder ? 'Processos recentes' : 'Fila prioritária'}</h3>
          {!isForwarder && <p className="small">Urgência, tipo de carga e ordem de chegada.</p>}
        </div>
        <div className="spacer">
          <Link to="/processos" className="button">
            Ver todos
          </Link>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referência</th>
              {!isForwarder && <th>Transitário</th>}
              <th>Carga</th>
              <th>Estado</th>
              <th>Submetido</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/processos/${p.id}`}>{p.reference}</Link>
                </td>
                {!isForwarder && <td>{p.forwarderName}</td>}
                <td>
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
        {!queue.length && stats && <Empty icon="inbox">Sem processos em curso.</Empty>}
      </div>
    </>
  )
}
