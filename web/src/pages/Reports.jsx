import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, downloadFile, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBox, Field, Icon, PRIORITY_LABELS, PROCESS_STATUS_LABELS, PageHeader, ProcessBadge, formatDate } from '../components/ui.jsx'
import { ColumnPairChart, DataTable, HBarChart, Meter, Panel, SegmentedBar, StatCard } from '../components/ReportKit.jsx'
import '../reports.css'

const BILLING_ROLES = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'FINANCAS', 'CHEFE_COMERCIAL']
const VOLUME_LABELS = { AUTO: 'Auto', CARGA_GRANEL: 'Carga granel', CARGA_GERAL: 'Carga geral', CONTENTOR: 'Contentor' }
const TAB_LABELS = { terminals: 'Terminais', processes: 'Processos', revenue: 'Receita', overdue: 'Atrasos' }

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000))
const PRESETS = [
  ['7 dias', () => daysAgo(6)],
  ['30 dias', () => daysAgo(29)],
  ['90 dias', () => daysAgo(89)],
  ['Este ano', () => `${new Date().getFullYear()}-01-01`],
]

const money = (amount, currency = 'AOA') => new Intl.NumberFormat('pt-AO', { style: 'currency', currency }).format(amount ?? 0)
const compactMoney = (amount, currency = 'AOA') =>
  new Intl.NumberFormat('pt-AO', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount ?? 0)
const fmtHours = (h) => (h === null || h === undefined ? '—' : h < 48 ? `${String(h).replace('.', ',')} h` : `${(h / 24).toFixed(1).replace('.', ',')} dias`)
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const longDate = (d) => {
  const [y, m, day] = d.split('-')
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`
}
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')

/** Grupos de estado para a barra empilhada: concluídos, em curso na Sogester, à espera do transitário, fechados. */
const STATUS_GROUPS = [
  ['done', 'Concluídos', ['CONCLUIDO']],
  ['active', 'Com a Sogester', ['SUBMETIDO', 'EM_ANALISE', 'DOCUMENTOS_SUBMETIDOS', 'EM_PROCESSAMENTO_INTERNO', 'PAGAMENTO_SUBMETIDO', 'PAGAMENTO_CONFIRMADO']],
  ['waiting', 'À espera do transitário', ['DOCUMENTOS_PENDENTES', 'PAGAMENTO_PENDENTE']],
  ['closed', 'Rejeitados ou cancelados', ['REJEITADO', 'CANCELADO']],
]

const refLink = (r) => (
  <Link to={`/processos/${r.id}`} className="rpt-strong">
    {r.reference}
  </Link>
)
const cargoTags = (r) => (
  <>
    {r.urgent && <span className="tag urgent">Urgente</span>}
    <span className={`tag prio-${r.cargoPriority}`}>{PRIORITY_LABELS[r.cargoPriority]}</span>
  </>
)

export default function Reports() {
  const { user } = useAuth()
  const canBill = BILLING_ROLES.includes(user.role)
  const isMaster = user.role === 'SUPER_ADMIN'
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const allowed = [...(isMaster ? ['terminals'] : []), 'processes', ...(canBill ? ['revenue', 'overdue'] : [])]
  const tab = allowed.includes(requested) ? requested : allowed[0]

  const [filters, setFilters] = useState({ from: daysAgo(89), to: ymd(new Date()), status: '', priority: '', forwarderId: '', entityId: '', minHours: '24' })
  const [forwarders, setForwarders] = useState([])
  const [entities, setEntities] = useState([])
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    api('GET', '/forwarders').then((r) => setForwarders(r.forwarders)).catch(() => {})
    if (isMaster) api('GET', '/entities').then((r) => setEntities(r.entities)).catch(() => {})
  }, [isMaster])

  const query = useCallback(
    (extra = {}) => {
      const q = new URLSearchParams()
      const used =
        tab === 'terminals'
          ? ['from', 'to', 'minHours']
          : tab === 'overdue'
            ? ['entityId', 'minHours']
            : tab === 'revenue'
              ? ['from', 'to', 'forwarderId', 'entityId']
              : ['from', 'to', 'status', 'priority', 'forwarderId', 'entityId']
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
  const dated = tab !== 'overdue'
  const today = ymd(new Date())
  const activePreset = PRESETS.find(([, from]) => filters.from === from() && filters.to === today)?.[0]

  return (
    <>
      <PageHeader title="Relatórios" subtitle={isMaster ? 'Indicadores de todos os terminais, lado a lado ou um a um.' : 'Indicadores do terminal, para acompanhar e exportar.'}>
        <button className="no-print" onClick={() => window.print()}>
          <Icon name="printer" /> Imprimir / PDF
        </button>
        {tab !== 'overdue' && (
          <button className="primary no-print" onClick={() => exportCsv()}>
            <Icon name="download" /> Exportar CSV
          </button>
        )}
      </PageHeader>

      <div className="rpt-toolbar no-print">
        <div className="rpt-segmented" role="tablist" aria-label="Relatório">
          {allowed.map((key) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setParams({ tab: key })}>
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>
        {loading && <span className="rpt-count">A atualizar…</span>}
      </div>

      <div className="rpt-filterbar no-print">
        {dated && (
          <>
            <div className="rpt-presets" role="group" aria-label="Período rápido">
              {PRESETS.map(([label, from]) => (
                <button key={label} type="button" className={activePreset === label ? 'active' : ''} onClick={() => setFilters((f) => ({ ...f, from: from(), to: today }))}>
                  {label}
                </button>
              ))}
            </div>
            <Field label="De">
              <input type="date" value={filters.from} max={filters.to} onChange={set('from')} />
            </Field>
            <Field label="Até">
              <input type="date" value={filters.to} min={filters.from} onChange={set('to')} />
            </Field>
          </>
        )}
        {isMaster && tab !== 'terminals' && (
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
        {(tab === 'processes' || tab === 'revenue') && (
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
        {(tab === 'overdue' || tab === 'terminals') && (
          <Field label="Parado há mais de">
            <select value={filters.minHours} onChange={set('minHours')}>
              {[[0, 'qualquer tempo'], [24, '24 horas'], [48, '48 horas'], [72, '3 dias'], [168, '7 dias']].map(([h, l]) => (
                <option key={h} value={h}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        )}
        {dated && data?.period && (
          <span className="rpt-period">
            {longDate(data.period.from)} – {longDate(data.period.to)}
          </span>
        )}
      </div>

      <ErrorBox message={error} />
      {loading && !data && <p className="muted">A carregar…</p>}
      {data && tab === 'terminals' && <TerminalsView report={data} />}
      {data && tab === 'processes' && <ProcessesView report={data} />}
      {data && tab === 'revenue' && <RevenueView report={data} />}
      {data && tab === 'overdue' && <OverdueView report={data} onExport={(kind) => exportCsv({ kind })} />}
    </>
  )
}

// ---- Terminais (administrador geral) -----------------------------------------------------------
const moneyList = (list) => (list.length ? list.map((m) => money(m.amount, m.currency)).join(' + ') : '—')
const amountIn = (list, currency) => list.find((m) => m.currency === currency)?.amount ?? 0

function TerminalsView({ report }) {
  const t = report.totals
  const rows = report.rows
  const currencies = [...new Set(rows.flatMap((r) => [...r.invoiced, ...r.collected].map((m) => m.currency)))]
  const currency = currencies.includes('AOA') ? 'AOA' : (currencies[0] ?? 'AOA')
  const bars = (pick) => rows.map((r) => ({ label: r.name, value: pick(r) })).sort((a, b) => b.value - a.value)
  const maxProc = Math.max(1, ...rows.map((r) => r.processes))
  const maxCollected = Math.max(1, ...rows.map((r) => amountIn(r.collected, currency)))
  const alerts = t.overduePayments + t.stalled

  const columns = [
    {
      key: 'name',
      label: 'Terminal',
      wrap: true,
      render: (r) => (
        <>
          <span className="rpt-strong">{r.name}</span>
          <span className="rpt-sub">
            {r.staff} na equipa · {r.forwarders} {r.forwarders === 1 ? 'transitário' : 'transitários'}
            {!r.active && ' · inativo'}
          </span>
        </>
      ),
    },
    { key: 'processes', label: 'Processos', num: true, bar: (r) => r.processes / maxProc },
    { key: 'inProgress', label: 'Em curso', num: true },
    { key: 'completed', label: 'Concluídos', num: true, render: (r) => (r.processes ? `${r.completed} · ${pct(r.completed, r.processes)}` : '0'), sort: (r) => r.completed },
    { key: 'avgHoursToComplete', label: 'Até concluir', num: true, render: (r) => fmtHours(r.avgHoursToComplete) },
    {
      key: 'collected',
      label: `Cobrado (${currency})`,
      num: true,
      sort: (r) => amountIn(r.collected, currency),
      render: (r) => money(amountIn(r.collected, currency), currency),
      bar: (r) => amountIn(r.collected, currency) / maxCollected,
    },
    { key: 'outstanding', label: 'Em aberto', num: true, sort: (r) => amountIn(r.outstanding, currency), render: (r) => moneyList(r.outstanding) },
    {
      key: 'alerts',
      label: 'Alertas',
      num: true,
      sort: (r) => r.overduePayments + r.stalled,
      render: (r) =>
        r.overduePayments + r.stalled ? (
          <span className="rpt-chip bad">
            <Icon name="alert" /> {r.overduePayments} atraso · {r.stalled} parados
          </span>
        ) : (
          <span className="rpt-chip ok">
            <Icon name="check" /> Sem alertas
          </span>
        ),
    },
    { key: 'earlyReleases', label: 'Saídas antec.', num: true, render: (r) => (r.earlyReleases ? `${r.earlyReleases} (${r.earlyReleasesUsed} usadas)` : '0') },
  ]

  return (
    <>
      <div className="rpt-stats">
        <StatCard icon="building" label="Terminais ativos" value={`${t.activeTerminals} de ${t.terminals}`} hint={`${t.staff} pessoas nas equipas`} />
        <StatCard icon="clipboard" label="Processos" value={t.processes} hint={`${t.inProgress} em curso · ${t.urgent} com urgência`} />
        <StatCard icon="check" tone="ok" label="Concluídos" value={t.completed} hint={`${pct(t.completed, t.processes)} dos processos do período`}>
          <Meter value={t.completed} total={t.processes} label="Taxa de conclusão" />
        </StatCard>
        <StatCard icon="card" label="Cobrado" value={moneyList(t.collected)} hint={`Faturado: ${moneyList(t.invoiced)}`} />
        <StatCard
          icon="alert"
          tone={alerts ? 'bad' : 'ok'}
          label="Alertas"
          value={alerts}
          hint={`${t.overduePayments} pagamentos em atraso · ${t.stalled} processos parados há mais de ${report.minHours} h`}
        />
      </div>

      <div className="rpt-grid-2">
        <Panel title="Processos por terminal" subtitle="Submetidos no período">
          <HBarChart items={bars((r) => r.processes)} format={(v) => `${v}`} />
        </Panel>
        <Panel title="Cobrado por terminal" subtitle={`Pagamentos confirmados no período, em ${currency}`}>
          <HBarChart items={bars((r) => amountIn(r.collected, currency))} format={(v) => money(v, currency)} />
        </Panel>
      </div>

      <Panel className="flush" title="Comparação entre terminais" subtitle="Clique num título de coluna para ordenar.">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.entityId}
          searchable={false}
          initialSort={{ key: 'processes', dir: 'desc' }}
          footer={
            <tr>
              <td>Total</td>
              <td className="num">{t.processes}</td>
              <td className="num">{t.inProgress}</td>
              <td className="num">
                {t.completed} · {pct(t.completed, t.processes)}
              </td>
              <td className="num">{fmtHours(t.avgHoursToComplete)}</td>
              <td className="num">{money(amountIn(t.collected, currency), currency)}</td>
              <td className="num">{moneyList(t.outstanding)}</td>
              <td className="num">{alerts}</td>
              <td className="num">{t.earlyReleases}</td>
            </tr>
          }
        />
      </Panel>
      <p className="rpt-note">
        Os valores contam só as proformas com valor indicado{t.withoutAmount ? ` (${t.withoutAmount} sem valor ficam de fora)` : ''}. Para ver os processos de um
        terminal, abra o separador «Processos» e escolha o terminal.
      </p>
    </>
  )
}

// ---- Processos -------------------------------------------------------------------------------
function ProcessesView({ report }) {
  const s = report.summary
  const status = useMemo(
    () =>
      Object.entries(s.byStatus)
        .map(([k, v]) => ({ label: PROCESS_STATUS_LABELS[k] ?? k, value: v }))
        .sort((a, b) => b.value - a.value),
    [s],
  )
  const groups = STATUS_GROUPS.map(([tone, label, list]) => ({ tone, label, value: list.reduce((n, k) => n + (s.byStatus[k] ?? 0), 0) }))
  const priority = Object.entries(s.byPriority)
    .map(([k, v]) => ({ label: PRIORITY_LABELS[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value)
  const volume = Object.entries(s.byVolume)
    .map(([k, v]) => ({ label: VOLUME_LABELS[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value)

  const columns = [
    { key: 'reference', label: 'Referência', render: refLink },
    { key: 'forwarderName', label: 'Transitário', wrap: true },
    { key: 'clientName', label: 'Cliente', wrap: true },
    { key: 'cargoPriority', label: 'Carga', wrap: true, render: cargoTags, sort: (r) => PRIORITY_LABELS[r.cargoPriority] },
    { key: 'status', label: 'Estado', render: (r) => <ProcessBadge status={r.status} />, sort: (r) => PROCESS_STATUS_LABELS[r.status], search: (r) => PROCESS_STATUS_LABELS[r.status] },
    { key: 'submittedAt', label: 'Submetido', render: (r) => <span className="muted" title={formatDate(r.submittedAt)}>{shortDate(r.submittedAt)}</span>, sort: (r) => r.submittedAt, search: () => '' },
    { key: 'hoursToApproval', label: 'Conformidade', num: true, render: (r) => fmtHours(r.hoursToApproval) },
    { key: 'hoursToComplete', label: 'Conclusão', num: true, render: (r) => fmtHours(r.hoursToComplete) },
    { key: 'amount', label: 'Proforma', num: true, render: (r) => (r.amount === null ? '—' : money(r.amount, r.currency)) },
  ]

  return (
    <>
      <div className="rpt-stats">
        <StatCard icon="clipboard" label="Processos" value={s.total} hint={`${s.urgent} com pedido de urgência`} />
        <StatCard icon="check" tone="ok" label="Concluídos" value={s.completed} hint={`${pct(s.completed, s.total)} do período`}>
          <Meter value={s.completed} total={s.total} label="Taxa de conclusão" />
        </StatCard>
        <StatCard icon="clock" label="Em curso" value={s.active} hint="Ainda sem conclusão" />
        <StatCard icon="clock" label="Até conformidade" value={fmtHours(s.avgHoursToApproval)} hint="Tempo médio da submissão aos documentos conformes" />
        <StatCard icon="check" label="Até concluir" value={fmtHours(s.avgHoursToComplete)} hint="Tempo médio da submissão à Factura/Recibo" />
        <StatCard icon="x" tone={s.cancelled + s.rejected ? 'warn' : undefined} label="Rejeitados e cancelados" value={s.cancelled + s.rejected} hint={`${s.rejected} rejeitados · ${s.cancelled} cancelados`} />
      </div>

      <Panel title="Onde estão os processos" subtitle="Passe o rato sobre a barra para ver cada grupo.">
        <SegmentedBar parts={groups} />
      </Panel>

      <div className="rpt-grid-3">
        <Panel title="Por estado">
          <HBarChart items={status} />
        </Panel>
        <Panel title="Por carga">
          <HBarChart items={priority} />
          <h4 className="rpt-sub" style={{ margin: '1rem 0 .4rem' }}>
            Por tipo de volume
          </h4>
          <HBarChart items={volume} />
        </Panel>
      </div>

      <Panel title="Transitários com mais processos" subtitle="Os 10 primeiros no período">
        <HBarChart items={s.byForwarder.map((f) => ({ label: f.name, value: f.total }))} />
      </Panel>

      <Panel className="flush" title="Processos do período">
        <DataTable columns={columns} rows={report.rows} empty="Sem processos no período." />
      </Panel>
      {report.totalRows > report.rows.length && (
        <p className="rpt-note">
          A mostrar {report.rows.length} de {report.totalRows} processos: exporte o CSV para ver todos.
        </p>
      )}
    </>
  )
}

// ---- Receita ---------------------------------------------------------------------------------
function RevenueView({ report }) {
  const currencies = report.totals
  const [currency, setCurrency] = useState(currencies[0]?.currency ?? 'AOA')
  const total = currencies.find((t) => t.currency === currency) ?? { invoiced: 0, collected: 0, outstanding: 0 }
  const series = report.series.filter((p) => p.currency === currency)
  const top = report.topForwarders.filter((f) => f.currency === currency)

  const columns = [
    { key: 'reference', label: 'Referência', render: refLink },
    { key: 'forwarderName', label: 'Transitário', wrap: true },
    { key: 'proformaNumber', label: 'Proforma', render: (r) => r.proformaNumber ?? '—' },
    { key: 'amount', label: 'Valor', num: true, render: (r) => (r.amount === null ? '—' : money(r.amount, r.currency)) },
    { key: 'proformaIssuedAt', label: 'Emitida', render: (r) => <span className="muted" title={formatDate(r.proformaIssuedAt)}>{shortDate(r.proformaIssuedAt)}</span>, sort: (r) => r.proformaIssuedAt, search: () => '' },
    {
      key: 'paymentConfirmedAt',
      label: 'Pagamento',
      sort: (r) => r.paymentConfirmedAt ?? '',
      search: (r) => (r.paymentConfirmedAt ? 'pago' : 'por cobrar'),
      render: (r) =>
        r.paymentConfirmedAt ? (
          <span className="rpt-chip ok">
            <Icon name="check" /> {shortDate(r.paymentConfirmedAt)}
          </span>
        ) : (
          <span className="rpt-chip warn">
            <Icon name="clock" /> Por cobrar
          </span>
        ),
    },
    { key: 'receiptNumber', label: 'Recibo', render: (r) => r.receiptNumber ?? '—' },
  ]

  return (
    <>
      {currencies.length > 1 && (
        <div className="rpt-toolbar no-print">
          <div className="rpt-segmented" role="group" aria-label="Moeda">
            {currencies.map((t) => (
              <button key={t.currency} className={currency === t.currency ? 'active' : ''} onClick={() => setCurrency(t.currency)}>
                {t.currency}
              </button>
            ))}
          </div>
        </div>
      )}
      {report.withoutAmount > 0 && (
        <p className="notice">
          <Icon name="alert" /> {report.withoutAmount}{' '}
          {report.withoutAmount === 1 ? 'proforma sem valor indicado ficou' : 'proformas sem valor indicado ficaram'} fora dos totais.
        </p>
      )}
      <div className="rpt-stats">
        <StatCard icon="file" label="Faturado" value={money(total.invoiced, currency)} hint="Proformas emitidas no período" />
        <StatCard icon="check" tone="ok" label="Cobrado" value={money(total.collected, currency)} hint={`${pct(total.collected, total.invoiced)} do faturado · pagamentos confirmados`}>
          <Meter value={Math.min(total.collected, total.invoiced)} total={total.invoiced} label="Cobrado sobre faturado" />
        </StatCard>
        <StatCard icon="clock" tone={total.outstanding ? 'warn' : undefined} label="Em aberto" value={money(total.outstanding, currency)} hint="Faturado no período ainda por cobrar" />
      </div>

      <div className="rpt-grid-3">
        <Panel title="Evolução mensal" subtitle="Faturado pela data da proforma; cobrado pela data da confirmação">
          {series.length ? (
            <ColumnPairChart
              points={series}
              labelOf={(p) => monthLabel(p.month)}
              format={(v) => compactMoney(v, currency)}
              series={[
                { key: 'invoiced', label: 'Faturado' },
                { key: 'collected', label: 'Cobrado' },
              ]}
            />
          ) : (
            <p className="rpt-empty">Sem movimentos no período.</p>
          )}
        </Panel>
        <Panel title="Cobrado por transitário" subtitle="Os 10 primeiros">
          <HBarChart items={top.map((f) => ({ label: f.forwarder, value: f.collected }))} format={(v) => compactMoney(v, currency)} />
        </Panel>
      </div>

      <Panel className="flush" title="Proformas e pagamentos">
        <DataTable columns={columns} rows={report.rows} empty="Sem faturação no período." />
      </Panel>
      <p className="rpt-note">Processos cancelados não entram nos totais.</p>
    </>
  )
}

// ---- Atrasos ---------------------------------------------------------------------------------
function OverdueView({ report, onExport }) {
  const { payments, stalled } = report
  const owed = payments.owed.map((o) => money(o.amount, o.currency)).join(' + ') || money(0)
  const waiting = Object.entries(stalled.byWaitingOn)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  const paymentColumns = [
    { key: 'reference', label: 'Referência', render: refLink },
    { key: 'forwarderName', label: 'Transitário', wrap: true },
    { key: 'status', label: 'Estado', render: (r) => <ProcessBadge status={r.status} />, sort: (r) => PROCESS_STATUS_LABELS[r.status], search: (r) => PROCESS_STATUS_LABELS[r.status] },
    { key: 'dueAt', label: 'Prazo', render: (r) => <span className="muted" title={formatDate(r.dueAt)}>{shortDate(r.dueAt)}</span>, search: () => '' },
    {
      key: 'hoursOverdue',
      label: 'Em atraso',
      num: true,
      render: (r) => (
        <span className="rpt-chip bad">
          <Icon name="alert" /> {fmtHours(r.hoursOverdue)}
        </span>
      ),
    },
    { key: 'extensions', label: 'Prorrogações', num: true },
    { key: 'amount', label: 'Valor', num: true, render: (r) => (r.amount === null ? '—' : money(r.amount, r.currency)) },
  ]
  const stalledColumns = [
    { key: 'reference', label: 'Referência', render: refLink },
    { key: 'forwarderName', label: 'Transitário', wrap: true },
    { key: 'status', label: 'Estado', render: (r) => <ProcessBadge status={r.status} />, sort: (r) => PROCESS_STATUS_LABELS[r.status], search: (r) => PROCESS_STATUS_LABELS[r.status] },
    { key: 'cargoPriority', label: 'Carga', wrap: true, render: cargoTags, sort: (r) => PRIORITY_LABELS[r.cargoPriority] },
    { key: 'waitingOn', label: 'A aguardar' },
    {
      key: 'hoursWaiting',
      label: 'Parado há',
      num: true,
      render: (r) => <span className={r.hoursWaiting >= 72 ? 'rpt-chip bad' : 'rpt-chip warn'}>{fmtHours(r.hoursWaiting)}</span>,
    },
  ]

  return (
    <>
      <div className="rpt-stats">
        <StatCard icon="alert" tone={payments.count ? 'bad' : 'ok'} label="Pagamentos em atraso" value={payments.count} hint="Saídas antecipadas com o prazo de pagamento vencido" />
        <StatCard icon="card" tone={payments.count ? 'bad' : undefined} label="Valor em dívida" value={owed} />
        <StatCard icon="clock" tone={stalled.count ? 'warn' : 'ok'} label="Processos parados" value={stalled.count} hint={`No mesmo estado há mais de ${report.minHours} h`} />
      </div>

      <div className="rpt-grid-3">
        <Panel
          className="flush"
          title="Pagamentos em atraso"
          subtitle="Cargas libertadas com compromisso de pagamento cujo prazo terminou."
          actions={
            <button onClick={() => onExport('payments')}>
              <Icon name="download" /> CSV
            </button>
          }
        >
          <DataTable columns={paymentColumns} rows={payments.rows} initialSort={{ key: 'hoursOverdue', dir: 'desc' }} empty="Sem pagamentos em atraso." pageSize={10} />
        </Panel>
        <Panel title="Quem tem de agir" subtitle="Processos parados, por responsável">
          <HBarChart items={waiting} empty="Nenhum processo parado." />
        </Panel>
      </div>

      <Panel
        className="flush"
        title="Processos parados"
        subtitle="Ordenados pelo tempo parado."
        actions={
          <button onClick={() => onExport('stalled')}>
            <Icon name="download" /> CSV
          </button>
        }
      >
        <DataTable columns={stalledColumns} rows={stalled.rows} initialSort={{ key: 'hoursWaiting', dir: 'desc' }} empty="Nenhum processo parado." />
      </Panel>
    </>
  )
}
