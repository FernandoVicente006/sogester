import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, downloadFile, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Empty, ErrorBox, Field, Icon, PRIORITY_LABELS, PROCESS_STATUS_LABELS, PageHeader, ProcessBadge, formatDate } from '../components/ui.jsx'

const BILLING_ROLES = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'FINANCAS', 'CHEFE_COMERCIAL']
const VOLUME_LABELS = { AUTO: 'Auto', CARGA_GRANEL: 'Carga granel', CARGA_GERAL: 'Carga geral', CONTENTOR: 'Contentor' }

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000))

const money = (amount, currency = 'AOA') => new Intl.NumberFormat('pt-AO', { style: 'currency', currency }).format(amount ?? 0)
const fmtHours = (h) => (h === null || h === undefined ? '—' : h < 48 ? `${h} h` : `${(h / 24).toFixed(1).replace('.', ',')} dias`)
const monthLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })

function Kpi({ icon, tone = '', value, label, money: isMoney }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-icon">
        <Icon name={icon} />
      </span>
      <div>
        <div className={isMoney ? 'kpi-value money' : 'kpi-value'}>{value}</div>
        <div className="kpi-label">{label}</div>
      </div>
    </div>
  )
}

/** Barras horizontais proporcionais ao maior valor; o valor vem sempre escrito ao lado. */
function BarList({ items, tone = '', format = (v) => v }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (!items.length) return <p className="muted small">Sem dados no período.</p>
  return (
    <div className="bars">
      {items.map((i) => (
        <div className="bar-row" key={i.label}>
          <span>{i.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span className={`bar-fill ${tone}`} style={{ width: `${(i.value / max) * 100}%`, display: 'block' }} />
          </span>
          <span className="bar-value">{format(i.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Reports() {
  const { user } = useAuth()
  const canBill = BILLING_ROLES.includes(user.role)
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = ['processes', 'revenue', 'overdue'].includes(requested) && (canBill || requested === 'processes') ? requested : 'processes'

  const [filters, setFilters] = useState({ from: daysAgo(89), to: ymd(new Date()), status: '', priority: '', forwarderId: '', entityId: '', minHours: '24' })
  const [forwarders, setForwarders] = useState([])
  const [entities, setEntities] = useState([])
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    api('GET', '/forwarders').then((r) => setForwarders(r.forwarders)).catch(() => {})
    if (user.role === 'SUPER_ADMIN') api('GET', '/entities').then((r) => setEntities(r.entities)).catch(() => {})
  }, [user.role])

  const query = useCallback(
    (extra = {}) => {
      const q = new URLSearchParams()
      const used = tab === 'overdue' ? ['entityId', 'minHours'] : tab === 'revenue' ? ['from', 'to', 'forwarderId', 'entityId'] : ['from', 'to', 'status', 'priority', 'forwarderId', 'entityId']
      for (const k of used) if (filters[k]) q.set(k, filters[k])
      for (const [k, v] of Object.entries(extra)) q.set(k, v)
      return q.toString()
    },
    [filters, tab],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport({ forTab: tab, data: (await api('GET', `/reports/${tab}?${query()}`)).report })
      setError('')
    } catch (err) {
      setReport(null)
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [tab, query])

  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [load])

  const exportCsv = (extra) => downloadFile(`/reports/${tab}?${query({ format: 'csv', ...extra })}`).catch((err) => setError(errorText(err)))

  // o relatório em memória pode ser de outro separador enquanto o novo carrega
  const data = report?.forTab === tab ? report.data : null
  const tabs = [['processes', 'Processos'], ...(canBill ? [['revenue', 'Receita'], ['overdue', 'Atrasos']] : [])]

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Indicadores e exportação de dados do terminal.">
        <button className="no-print" onClick={() => window.print()}>
          <Icon name="printer" /> Imprimir / PDF
        </button>
        {tab !== 'overdue' && (
          <button className="primary no-print" onClick={() => exportCsv()}>
            <Icon name="download" /> Exportar CSV
          </button>
        )}
      </PageHeader>

      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setParams({ tab: key })}>
            {label}
          </button>
        ))}
      </div>

      <section className="card no-print">
        <div className="filter-grid">
          {tab !== 'overdue' && (
            <>
              <Field label="De">
                <input type="date" value={filters.from} max={filters.to} onChange={set('from')} />
              </Field>
              <Field label="Até">
                <input type="date" value={filters.to} min={filters.from} onChange={set('to')} />
              </Field>
            </>
          )}
          {user.role === 'SUPER_ADMIN' && (
            <Field label="Terminal">
              <select value={filters.entityId} onChange={set('entityId')}>
                <option value="">Todos</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {tab !== 'overdue' && (
            <Field label="Transitário">
              <select value={filters.forwarderId} onChange={set('forwarderId')}>
                <option value="">Todos</option>
                {forwarders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {tab === 'processes' && (
            <>
              <Field label="Estado">
                <select value={filters.status} onChange={set('status')}>
                  <option value="">Todos</option>
                  {Object.entries(PROCESS_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prioridade">
                <select value={filters.priority} onChange={set('priority')}>
                  <option value="">Todas</option>
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {tab === 'overdue' && (
            <Field label="Processo parado há mais de">
              <select value={filters.minHours} onChange={set('minHours')}>
                {[[0, 'qualquer tempo'], [24, '24 horas'], [48, '48 horas'], [72, '3 dias'], [168, '7 dias']].map(([h, l]) => (
                  <option key={h} value={h}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      <ErrorBox message={error} />
      {loading && !data && <p className="muted">A carregar…</p>}
      {data && tab === 'processes' && <ProcessesView report={data} />}
      {data && tab === 'revenue' && <RevenueView report={data} />}
      {data && tab === 'overdue' && <OverdueView report={data} onExport={(kind) => exportCsv({ kind })} />}
    </>
  )
}

function ProcessesView({ report }) {
  const s = report.summary
  const status = useMemo(() => Object.entries(s.byStatus).map(([k, v]) => ({ label: PROCESS_STATUS_LABELS[k] ?? k, value: v })).sort((a, b) => b.value - a.value), [s])
  const priority = Object.entries(s.byPriority).map(([k, v]) => ({ label: PRIORITY_LABELS[k] ?? k, value: v })).sort((a, b) => b.value - a.value)
  const volume = Object.entries(s.byVolume).map(([k, v]) => ({ label: VOLUME_LABELS[k] ?? k, value: v })).sort((a, b) => b.value - a.value)
  return (
    <>
      <div className="kpis">
        <Kpi icon="clipboard" value={s.total} label="Processos no período" />
        <Kpi icon="check" tone="green" value={s.completed} label="Concluídos" />
        <Kpi icon="clock" tone="amber" value={s.active} label="Em curso" />
        <Kpi icon="x" tone="red" value={s.cancelled + s.rejected} label="Cancelados e rejeitados" />
        <Kpi icon="clock" value={fmtHours(s.avgHoursToApproval)} label="Tempo médio até conformidade" />
        <Kpi icon="check" tone="green" value={fmtHours(s.avgHoursToComplete)} label="Tempo médio até concluir" />
      </div>
      <div className="two-col">
        <section className="card">
          <h3>Por estado</h3>
          <BarList items={status} />
        </section>
        <section className="card">
          <h3>Por prioridade da carga</h3>
          <BarList items={priority} tone="amber" />
          <h3 style={{ marginTop: '1.25rem' }}>Por tipo de volume</h3>
          <BarList items={volume} />
        </section>
      </div>
      <section className="card">
        <h3>Transitários com mais processos</h3>
        <BarList items={s.byForwarder.map((f) => ({ label: f.name, value: f.total }))} tone="green" />
      </section>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referência</th>
              <th>Transitário</th>
              <th>Cliente</th>
              <th>Carga</th>
              <th>Estado</th>
              <th>Submetido</th>
              <th className="num">Até conformidade</th>
              <th className="num">Até concluir</th>
              <th className="num">Proforma</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/processos/${r.id}`}>{r.reference}</Link>
                </td>
                <td>{r.forwarderName}</td>
                <td>{r.clientName}</td>
                <td>
                  {r.urgent && <span className="tag urgent">Urgente</span>}
                  <span className={`tag prio-${r.cargoPriority}`}>{PRIORITY_LABELS[r.cargoPriority]}</span>
                </td>
                <td>
                  <ProcessBadge status={r.status} />
                </td>
                <td className="muted">{formatDate(r.submittedAt)}</td>
                <td className="num">{fmtHours(r.hoursToApproval)}</td>
                <td className="num">{fmtHours(r.hoursToComplete)}</td>
                <td className="num">{r.amount === null ? '—' : money(r.amount, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report.rows.length && <Empty icon="chart">Sem processos no período.</Empty>}
      </div>
      {report.totalRows > report.rows.length && <p className="muted small">A mostrar {report.rows.length} de {report.totalRows} linhas: exporte o CSV para ver tudo.</p>}
    </>
  )
}

function RevenueView({ report }) {
  const currencies = report.totals
  const [currency, setCurrency] = useState(currencies[0]?.currency ?? 'AOA')
  const total = currencies.find((t) => t.currency === currency) ?? { invoiced: 0, collected: 0, outstanding: 0 }
  const series = report.series.filter((p) => p.currency === currency)
  const max = Math.max(1, ...series.flatMap((p) => [p.invoiced, p.collected]))
  const top = report.topForwarders.filter((f) => f.currency === currency)
  return (
    <>
      {currencies.length > 1 && (
        <div className="filters no-print">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Moeda">
            {currencies.map((t) => (
              <option key={t.currency}>{t.currency}</option>
            ))}
          </select>
        </div>
      )}
      {report.withoutAmount > 0 && (
        <p className="notice">
          <Icon name="alert" /> {report.withoutAmount} {report.withoutAmount === 1 ? 'proforma sem valor indicado ficou' : 'proformas sem valor indicado ficaram'} fora dos totais.
        </p>
      )}
      <div className="kpis">
        <Kpi icon="file" value={money(total.invoiced, currency)} money label="Faturado (proformas emitidas)" />
        <Kpi icon="check" tone="green" value={money(total.collected, currency)} money label="Cobrado (pagamentos confirmados)" />
        <Kpi icon="clock" tone="amber" value={money(total.outstanding, currency)} money label="Em aberto (faturado por cobrar)" />
      </div>
      <p className="muted small">Faturado e cobrado contam pela data da proforma e da confirmação do pagamento, respetivamente. Processos cancelados não entram.</p>
      <div className="two-col">
        <section className="card">
          <h3>Evolução mensal</h3>
          {series.length ? (
            <>
              <div className="columns" role="img" aria-label="Faturado e cobrado por mês">
                {series.map((p) => (
                  <div className="col-group" key={p.month}>
                    <div className="col-bars">
                      <div className="col" style={{ height: `${(p.invoiced / max) * 100}%` }} title={`Faturado: ${money(p.invoiced, currency)}`} />
                      <div className="col green" style={{ height: `${(p.collected / max) * 100}%` }} title={`Cobrado: ${money(p.collected, currency)}`} />
                    </div>
                    <span className="col-label">{monthLabel(p.month)}</span>
                  </div>
                ))}
              </div>
              <div className="legend">
                <span>
                  <i />
                  Faturado
                </span>
                <span>
                  <i className="green" />
                  Cobrado
                </span>
              </div>
            </>
          ) : (
            <p className="muted small">Sem movimentos no período.</p>
          )}
        </section>
        <section className="card">
          <h3>Cobrado por transitário</h3>
          <BarList items={top.map((f) => ({ label: f.forwarder, value: f.collected }))} tone="green" format={(v) => money(v, currency)} />
        </section>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referência</th>
              <th>Transitário</th>
              <th>Proforma</th>
              <th className="num">Valor</th>
              <th>Emitida</th>
              <th>Pagamento</th>
              <th>Recibo</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/processos/${r.id}`}>{r.reference}</Link>
                </td>
                <td>{r.forwarderName}</td>
                <td>{r.proformaNumber}</td>
                <td className="num">{r.amount === null ? '—' : money(r.amount, r.currency)}</td>
                <td className="muted">{formatDate(r.proformaIssuedAt)}</td>
                <td>{r.paymentConfirmedAt ? <span className="badge badge-APROVADO">{formatDate(r.paymentConfirmedAt)}</span> : <span className="badge badge-PENDENTE">Por cobrar</span>}</td>
                <td>{r.receiptNumber ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report.rows.length && <Empty icon="chart">Sem faturação no período.</Empty>}
      </div>
    </>
  )
}

function OverdueView({ report, onExport }) {
  const { payments, stalled } = report
  const owed = payments.owed.map((o) => money(o.amount, o.currency)).join(' + ') || money(0)
  return (
    <>
      <div className="kpis">
        <Kpi icon="alert" tone="red" value={payments.count} label="Pagamentos em atraso" />
        <Kpi icon="card" tone="red" value={owed} money label="Valor em dívida" />
        <Kpi icon="clock" tone="amber" value={stalled.count} label={`Processos parados há mais de ${report.minHours} h`} />
      </div>

      <div className="page-head">
        <div>
          <h3 style={{ margin: 0 }}>Pagamentos em atraso</h3>
          <p className="small">Cargas libertadas com compromisso de pagamento cujo prazo terminou.</p>
        </div>
        <div className="spacer no-print">
          <button onClick={() => onExport('payments')}>
            <Icon name="download" /> Exportar CSV
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referência</th>
              <th>Transitário</th>
              <th>Estado</th>
              <th>Prazo</th>
              <th className="num">Em atraso</th>
              <th className="num">Prorrogações</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {payments.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/processos/${r.id}`}>{r.reference}</Link>
                </td>
                <td>{r.forwarderName}</td>
                <td>
                  <ProcessBadge status={r.status} />
                </td>
                <td className="muted">{formatDate(r.dueAt)}</td>
                <td className="num">
                  <span className="tag urgent">{fmtHours(r.hoursOverdue)}</span>
                </td>
                <td className="num">{r.extensions}</td>
                <td className="num">{r.amount === null ? '—' : money(r.amount, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payments.rows.length && <Empty icon="check">Sem pagamentos em atraso.</Empty>}
      </div>

      <div className="page-head" style={{ marginTop: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>Processos parados</h3>
          <p className="small">Quem tem de agir: {Object.entries(stalled.byWaitingOn).map(([k, v]) => `${k} (${v})`).join(' · ') || 'ninguém'}.</p>
        </div>
        <div className="spacer no-print">
          <button onClick={() => onExport('stalled')}>
            <Icon name="download" /> Exportar CSV
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referência</th>
              <th>Transitário</th>
              <th>Estado</th>
              <th>Carga</th>
              <th>A aguardar</th>
              <th className="num">Parado há</th>
            </tr>
          </thead>
          <tbody>
            {stalled.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/processos/${r.id}`}>{r.reference}</Link>
                </td>
                <td>{r.forwarderName}</td>
                <td>
                  <ProcessBadge status={r.status} />
                </td>
                <td>
                  {r.urgent && <span className="tag urgent">Urgente</span>}
                  <span className={`tag prio-${r.cargoPriority}`}>{PRIORITY_LABELS[r.cargoPriority]}</span>
                </td>
                <td>{r.waitingOn}</td>
                <td className="num">{fmtHours(r.hoursWaiting)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!stalled.rows.length && <Empty icon="check">Nenhum processo parado.</Empty>}
      </div>
    </>
  )
}
