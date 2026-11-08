import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import Chat from '../components/Chat.jsx'
import { CorrectionsToDo, RequestCorrections, openIssues } from '../components/Corrections.jsx'
import Viewer, { DocumentPane } from '../components/Viewer.jsx'
import { ErrorBox, Field, Icon, Modal, PRIORITY_LABELS, PROCESS_STATUS_LABELS, ProcessBadge, formatDate } from '../components/ui.jsx'

// Fases do ciclo de vida para o indicador de progresso (cada fase agrupa vários estados).
const PHASES = ['Submetido', 'Análise', 'Processamento', 'Pagamento', 'Concluído']
const PHASE_OF = {
  SUBMETIDO: 0,
  EM_ANALISE: 1,
  DOCUMENTOS_PENDENTES: 1,
  DOCUMENTOS_SUBMETIDOS: 1,
  EM_PROCESSAMENTO_INTERNO: 2,
  PAGAMENTO_PENDENTE: 3,
  PAGAMENTO_SUBMETIDO: 3,
  PAGAMENTO_CONFIRMADO: 3,
  CONCLUIDO: 4,
}

function Stepper({ process: p }) {
  const rejected = ['REJEITADO', 'CANCELADO'].includes(p.status)
  // Em processos rejeitados, a falha marca a fase em que estava antes da rejeição.
  const before = rejected ? p.history.at(-2)?.toStatus : null
  const current = rejected ? (PHASE_OF[before] ?? 0) : PHASE_OF[p.status]
  const finished = p.status === 'CONCLUIDO'
  return (
    <ol className="stepper" aria-label="Progresso do processo">
      {PHASES.map((label, i) => {
        const state = finished || i < current ? 'done' : i === current ? (rejected ? 'failed' : 'current') : ''
        return (
          <li key={label} className={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="dot">{state === 'done' ? <Icon name="check" /> : state === 'failed' ? <Icon name="x" /> : i + 1}</span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}

const DOC_LABELS = {
  BILHETE: 'Bilhete de identidade',
  ALVARA: 'Alvará comercial',
  GUIA_CABOTAGEM: 'Guia de cabotagem',
  BL: 'BL',
  EP17: 'EP17',
  EP15: 'EP15',
  RECIBO_EP: 'Recibo do EP',
  DOCUMENTOS: 'Documentação',
  OUTRO: 'Outro',
  PROFORMA: 'Fatura proforma',
  COMPROVATIVO: 'Comprovativo de pagamento',
  FATURA_RECIBO: 'Fatura recibo',
}
const AUTHORIZABLE = ['EM_ANALISE', 'DOCUMENTOS_SUBMETIDOS', 'EM_PROCESSAMENTO_INTERNO']
/** Estado da saída antecipada para mostrar ao utilizador. */
function releaseState(a) {
  if (!a.accepted) return 'Aguarda o aceite do transitário'
  if (a.usedAt) return `Usada na portaria em ${formatDate(a.usedAt)}${a.usedBy ? ` (${a.usedBy})` : ''}`
  if (a.validUntil && new Date(a.validUntil) < new Date()) return 'Expirada'
  return a.validUntil ? `Válida até ${formatDate(a.validUntil)}` : 'Válida'
}
const AUTHORIZERS = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'CHEFE_COMERCIAL']
const PROFORMA_UPLOADERS = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'LOJA']
const FINANCE = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'FINANCAS']
const money = (amount, currency) => new Intl.NumberFormat('pt-AO', { style: 'currency', currency }).format(amount)
// Processos antigos ainda têm este estado no histórico.
const historyLabel = (status) => (status === 'AUTORIZACAO_EMITIDA' ? 'Autorização emitida' : (PROCESS_STATUS_LABELS[status] ?? status))
/** Só envia os campos preenchidos: na proforma e no recibo apenas o ficheiro é obrigatório. */
const filled = (data) => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v != null))
const VOLUME_LABELS = { AUTO: 'Auto', CARGA_GRANEL: 'Carga granel', CARGA_GERAL: 'Carga geral', CONTENTOR: 'Contentor' }

// Transições que a Sogester pode fazer a partir de cada estado (espelha o servidor).
const STAFF_ACTIONS = {
  SUBMETIDO: [['EM_ANALISE', 'Iniciar análise'], ['REJEITADO', 'Rejeitar']],
  EM_ANALISE: [['EM_PROCESSAMENTO_INTERNO', 'Documentos conformes'], ['DOCUMENTOS_PENDENTES', 'Pedir correções'], ['REJEITADO', 'Rejeitar']],
  DOCUMENTOS_PENDENTES: [['REJEITADO', 'Rejeitar (sem resposta)']],
  DOCUMENTOS_SUBMETIDOS: [['EM_PROCESSAMENTO_INTERNO', 'Documentos conformes'], ['EM_ANALISE', 'Voltar à análise'], ['DOCUMENTOS_PENDENTES', 'Pedir correções'], ['REJEITADO', 'Rejeitar']],
  EM_PROCESSAMENTO_INTERNO: [['DOCUMENTOS_PENDENTES', 'Pedir correções'], ['REJEITADO', 'Rejeitar']],
}
const NOTES_REQUIRED = ['REJEITADO']
const BILLING_DOCS = ['PROFORMA', 'COMPROVATIVO', 'FATURA_RECIBO']
const REVIEWERS = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'LOJA']

const PRE_AUTH = ['SUBMETIDO', 'EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'DOCUMENTOS_SUBMETIDOS']
const POST_AUTH = ['EM_PROCESSAMENTO_INTERNO', 'PAGAMENTO_PENDENTE', 'PAGAMENTO_SUBMETIDO']
const ADMINS = ['SUPER_ADMIN', 'ADMIN_ENTIDADE']

// Cada ação com motivo obrigatório: título, rótulo do campo, endpoint e se é destrutiva.
const DIALOGS = {
  withdraw: { title: 'Cancelar processo', label: 'Motivo do cancelamento', path: '/cancellation', confirm: 'Cancelar processo', danger: true, hint: 'O processo será cancelado de imediato.' },
  staffCancel: { title: 'Cancelar processo', label: 'Motivo do cancelamento', path: '/cancel', confirm: 'Cancelar processo', danger: true, hint: 'O transitário será informado.' },
  revoke: { title: 'Revogar autorização', label: 'Motivo da revogação', path: '/authorization/revoke', confirm: 'Revogar autorização', danger: true, hint: 'O código deixa de ser válido e o prazo de pagamento é retirado.' },
  extend: { title: 'Prorrogar prazo de pagamento', label: 'Justificação', path: '/extend-deadline', confirm: 'Prorrogar', days: true, hint: 'Máximo de 2 prorrogações por compromisso, até 7 dias cada.' },
  reopen: { title: 'Reabrir processo', label: 'Motivo da reabertura', path: '/reopen', confirm: 'Reabrir', hint: 'O processo volta à análise.' },
}

export default function ProcessDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [p, setP] = useState(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const [docFile, setDocFile] = useState(null)
  const [requesting, setRequesting] = useState(false)

  const run = useCallback(async (fn) => {
    setError('')
    try {
      setP((await fn()).process)
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  const [viewing, setViewing] = useState(null)
  const [dialog, setDialog] = useState(null) // chave de DIALOGS
  const [dialogReason, setDialogReason] = useState('')
  const [dialogDays, setDialogDays] = useState(3)
  const [terms, setTerms] = useState(null)
  const [sign, setSign] = useState({ password: '', accept: false })
  const [release, setRelease] = useState({ reason: '', validDays: 3 })
  const [proforma, setProforma] = useState({ number: '', amount: '', paymentEntity: '', paymentReference: '', dueDate: '', file: null })
  const [receipt, setReceipt] = useState({ number: '', file: null })
  const [proofFile, setProofFile] = useState(null)
  const [paying, setPaying] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    run(() => api('GET', `/processes/${id}`))
  }, [id, run])

  const needsCommitment =
    user.role === 'TRANSITARIO' && p?.authorization && !p.authorization.accepted && AUTHORIZABLE.includes(p.status)
  useEffect(() => {
    if (!needsCommitment) return
    api('GET', `/processes/${id}/commitment-terms`)
      .then(setTerms)
      .catch((err) => setError(errorText(err)))
  }, [needsCommitment, id])

  if (!p) return error ? <ErrorBox message={error} /> : <p className="muted">A carregar…</p>

  const isForwarder = user.role === 'TRANSITARIO'
  const actions = REVIEWERS.includes(user.role) ? (STAFF_ACTIONS[p.status] ?? []) : []
  const canAuthorize = AUTHORIZERS.includes(user.role) && AUTHORIZABLE.includes(p.status) && !p.authorization
  const canUploadProforma = PROFORMA_UPLOADERS.includes(user.role)
  const isFinance = FINANCE.includes(user.role)
  const earlyRelease = p.authorization?.type === 'SAIDA_ANTECIPADA'
  const exceptionActions = [
    PRE_AUTH.includes(p.status) && !earlyRelease && ['staffCancel', 'Cancelar processo'],
    p.authorization && (PRE_AUTH.includes(p.status) || POST_AUTH.includes(p.status)) && ['revoke', 'Revogar autorização'],
    p.commitment?.dueAt && p.commitment.extensionsLeft > 0 && !['PAGAMENTO_CONFIRMADO', 'CONCLUIDO', 'CANCELADO'].includes(p.status) && ['extend', 'Prorrogar prazo de pagamento'],
    p.status === 'REJEITADO' && ['reopen', 'Reabrir processo'],
  ].filter(Boolean)
  const openDialog = (key) => {
    setDialogReason('')
    setDialogDays(3)
    setDialog(key)
  }
  const submitDialog = (e) => {
    e.preventDefault()
    const cfg = DIALOGS[dialog]
    const body = cfg.days ? { days: Number(dialogDays), reason: dialogReason } : { reason: dialogReason }
    post(cfg.path, { body })
    setDialog(null)
  }
  const post = (path, options) => run(() => api('POST', `/processes/${id}${path}`, options))
  const formWith = (data, fileField, file) => {
    const f = new FormData()
    if (data) f.append('data', JSON.stringify(data))
    f.append(fileField, file)
    return f
  }

  const transition = (status) => {
    if (status === 'DOCUMENTOS_PENDENTES') return setRequesting(true)
    if (NOTES_REQUIRED.includes(status) && !notes.trim()) {
      setError('Indique o motivo ou os documentos em falta.')
      return
    }
    run(() => api('POST', `/processes/${id}/transition`, { body: { status, notes: notes.trim() || undefined } }))
    setNotes('')
  }

  const upload = (e) => {
    e.preventDefault()
    if (!docFile) return
    const form = new FormData()
    form.append('kind', 'OUTRO')
    form.append('file', docFile)
    run(() => api('POST', `/processes/${id}/documents`, { form }))
    setDocFile(null)
    e.target.reset()
  }

  const pendingIssues = openIssues(p)
  const documentPath = (doc) => `/processes/${id}/documents/${doc.id}`
  const open = (doc) => setViewing({ path: documentPath(doc), name: doc.originalName })
  // Um comprovativo recusado é substituído: o último documento de cada tipo é o que conta.
  const latest = (kind) => p.documents.findLast((d) => d.kind === kind)
  const proformaDoc = latest('PROFORMA')
  const proofDoc = latest('COMPROVATIVO')
  const receiptDoc = latest('FATURA_RECIBO')
  const inspectable = p.documents.filter((d) => !BILLING_DOCS.includes(d.kind))
  const reject = () => {
    post('/reject-payment', { body: { notes: notes.trim() } })
    setNotes('')
    setReviewing(false)
  }

  const row = (label, value) => (
    <>
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </>
  )

  return (
    <>
      <Link to={p.archivedAt ? '/arquivados' : '/processos'} className="crumb">
        <Icon name="back" /> {p.archivedAt ? 'Arquivados' : 'Processos'}
      </Link>
      <div className="process-head">
        <h2>{p.reference}</h2>
        <ProcessBadge status={p.status} />
        {p.urgencyRequested && <span className="tag urgent">Urgente</span>}
        <span className={`tag prio-${p.cargoPriority}`}>{PRIORITY_LABELS[p.cargoPriority]}</span>
        {p.paymentOverdue && <span className="tag urgent">Em incumprimento</span>}
        {p.archivedAt && <span className="tag">Arquivado em {formatDate(p.archivedAt)}</span>}
      </div>
      <Stepper process={p} />
      <ErrorBox message={error} />
      {p.statusNotes && ['DOCUMENTOS_PENDENTES', 'REJEITADO', 'PAGAMENTO_PENDENTE', 'CANCELADO'].includes(p.status) && (
        <p className={['REJEITADO', 'CANCELADO'].includes(p.status) ? 'notice danger' : 'notice'}>
          <Icon name="alert" />
          <span>
            <strong>Sogester:</strong> {p.statusNotes}
          </span>
        </p>
      )}

      <div className="detail-grid">
      <div>
      <section className="card">
        <h3>
          <Icon name="file" /> Detalhes
        </h3>
        <dl className="details">
          {row('Terminal', p.entityCode)}
          {row('Transitário', p.forwarderName)}
          {row('Cliente', `${p.client.name} (${p.client.type === 'SINGULAR' ? 'singular' : 'empresa'}${p.client.isForeign ? ', estrangeira' : ''})`)}
          {row('Documento do cliente', p.client.documentNumber)}
          {row('Prioridade', PRIORITY_LABELS[p.cargoPriority])}
          {p.urgencyRequested && row('Urgência', p.urgencyReason)}
          {row('Tipo principal de volume', VOLUME_LABELS[p.volumeType])}
          {p.cargoCategory && row('Tipo de carga', p.cargoCategory)}
          {p.description && row('Descrição', p.description)}
          {row('Submetido em', formatDate(p.submittedAt))}
        </dl>
      </section>

      {p.blNumber && (
        <section className="card">
          <h3>
            <Icon name="truck" /> Transporte
          </h3>
          <dl className="details">
            {p.operation && row('Operação', p.operation === 'EMBARQUE' ? 'Embarque (EP15)' : 'Desembarque (EP17)')}
            {row('N.º do B/L', p.blNumber)}
            {row('N.º do DU', p.duNumber)}
            {row('Navio / viagem', `${p.vesselName} · ${p.voyageNumber}`)}
            {row('Tipo de descarga', p.dischargeType === 'DIRECTA' ? 'Directa' : 'Indirecta')}
            {p.regime && row('Regime', p.regime)}
            {p.manifestNumber && row('Manifesto', p.manifestNumber)}
            {p.weightKg != null && row('Peso bruto (kg)', p.weightKg)}
            {p.packagesCount != null && row('N.º de volumes', p.packagesCount)}
            {(p.originCountry || p.destinationCountry) && row('Origem / destino', `${p.originCountry ?? '—'} → ${p.destinationCountry ?? '—'}`)}
          </dl>
        </section>
      )}

      {(p.vehicles.length > 0 || p.containers.length > 0 || p.goods.length > 0) && (
        <section className="card stack">
          <h3>
            <Icon name="clipboard" /> Carga
          </h3>
          {p.vehicles.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Veículo</th>
                    <th>Chassi</th>
                    <th>Combustível</th>
                    <th>Posição pautal</th>
                  </tr>
                </thead>
                <tbody>
                  {p.vehicles.map((v) => (
                    <tr key={v.id}>
                      <td>{v.brand} {v.model}</td>
                      <td>{v.chassis ?? '—'}</td>
                      <td>{v.fuel ?? '—'}</td>
                      <td>{v.tariffCode ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {p.containers.length > 0 && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Contentor</th>
                      <th>Pés</th>
                      <th>Tipo</th>
                      <th>Estado</th>
                      <th>Selo</th>
                      <th className="num">Volumes</th>
                      <th className="num">Peso (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.containers.map((c) => (
                      <tr key={c.id}>
                        <td>{c.number}</td>
                        <td>{c.size ? `${c.size}'` : '—'}</td>
                        <td>{c.type ?? '—'}</td>
                        <td>{c.loadStatus === 'CHEIO' ? 'Cheio' : c.loadStatus === 'VAZIO' ? 'Vazio' : '—'}</td>
                        <td>{c.seal ?? '—'}</td>
                        <td className="num">{c.packages ?? '—'}</td>
                        <td className="num">{c.weightKg ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Contentores de 20&apos;: {p.containerTotals['20']} · 40&apos;: {p.containerTotals['40']} · 45&apos;: {p.containerTotals['45']}
              </p>
            </>
          )}
          {p.goods.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mercadoria</th>
                    <th className="num">Quantidade</th>
                    <th className="num">Peso (kg)</th>
                    <th>Código pautal</th>
                    <th>Transportada em</th>
                  </tr>
                </thead>
                <tbody>
                  {p.goods.map((g, i) => (
                    <tr key={i}>
                      <td>{g.description}</td>
                      <td className="num">
                        {g.quantity} {g.unit}
                      </td>
                      <td className="num">{g.weightKg ?? '—'}</td>
                      <td>{g.tariffCode ?? '—'}</td>
                      <td>{g.vehicleName ? `${g.vehicleName}${g.vehicleChassis ? ` (${g.vehicleChassis})` : ''}` : (g.containerNumber ?? 'Solta')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {actions.length > 0 && (
        <section className="card stack">
          <h3><Icon name="clipboard" /> Análise</h3>
          <p className="muted small">Abra cada documento para inspecionar e decida abaixo.</p>
          <ul className="docs">
            {inspectable.map((d) => (
              <li key={d.id}>
                <Icon name="file" />
                <button className="link" onClick={() => open(d)}>
                  {DOC_LABELS[d.kind]}: {d.originalName}
                </button>
              </li>
            ))}
          </ul>
          <Field label="Motivo (obrigatório para rejeitar)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
          <div className="actions-left">
            {actions.map(([status, label]) => (
              <button key={status} className={status === 'REJEITADO' ? '' : 'primary'} onClick={() => transition(status)}>
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {needsCommitment && terms && (
        <section className="card stack">
          <h3><Icon name="shield" /> Aceitar a saída antecipada</h3>
          <p className="muted">
            A Sogester autorizou a saída antecipada da carga. Para poder imprimir a autorização, aceite o compromisso de pagamento abaixo.
          </p>
          <blockquote className="terms">{terms.text}</blockquote>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              post('/commitment', { body: sign })
              setSign({ password: '', accept: false })
            }}
          >
            <label className="check">
              <input type="checkbox" checked={sign.accept} onChange={(e) => setSign({ ...sign, accept: e.target.checked })} />
              Li e aceito os termos
            </label>
            <Field label="Palavra-passe (assinatura digital)">
              <input type="password" value={sign.password} onChange={(e) => setSign({ ...sign, password: e.target.value })} required />
            </Field>
            <button className="primary" disabled={!sign.accept}>
              Aceitar e assinar
            </button>
          </form>
        </section>
      )}

      {p.commitment && (
        <p className={p.paymentOverdue ? 'notice danger' : 'notice'}>
          Compromisso de pagamento aceite por {p.commitment.signedBy} em {formatDate(p.commitment.signedAt)}.
          {p.commitment.dueAt ? ` Data limite de pagamento: ${formatDate(p.commitment.dueAt)}.` : ' A data limite é fixada com a proforma.'}
          {p.paymentOverdue && ' PROCESSO EM INCUMPRIMENTO: a Sogester pode aplicar multa.'}
          {p.commitment.extensions?.length > 0 &&
            ` Prorrogado ${p.commitment.extensions.length}× (último: +${p.commitment.extensions.at(-1).days} dia(s), ${p.commitment.extensions.at(-1).reason}).`}
        </p>
      )}

      {canAuthorize && (
        <section className="card stack">
          <h3><Icon name="shield" /> Saída antecipada</h3>
          <p className="muted">
            Só para problemas da Sogester que impedem a saída da carga. O transitário tem de aceitar o compromisso de pagamento
            antes de imprimir a autorização, que vale para uma única saída.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              post('/authorization', { body: { reason: release.reason.trim(), validDays: Number(release.validDays) } })
            }}
          >
            <Field label="Motivo (problema da Sogester)">
              <textarea value={release.reason} onChange={(e) => setRelease({ ...release, reason: e.target.value })} minLength={10} maxLength={500} rows={3} required />
            </Field>
            <Field label="Validade da autorização">
              <select value={release.validDays} onChange={(e) => setRelease({ ...release, validDays: e.target.value })}>
                {[1, 2, 3, 5, 7, 10, 15].map((d) => (
                  <option key={d} value={d}>
                    {d} {d === 1 ? 'dia' : 'dias'}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <button className="primary">Emitir saída antecipada</button>
            </div>
          </form>
        </section>
      )}

      {p.authorization && (
        <section className="card">
          <h3><Icon name="shield" /> {p.authorization.type === 'SAIDA_ANTECIPADA' ? 'Saída antecipada' : 'Autorização digital'}</h3>
          <dl className="details">
            {row('Estado', releaseState(p.authorization))}
            {row('Código', <code>{p.authorization.code}</code>)}
            {p.authorization.reason && row('Motivo', p.authorization.reason)}
            {row('Emitida por', `${p.authorization.issuedBy} · ${formatDate(p.authorization.issuedAt)}`)}
            {p.authorization.notes && row('Notas', p.authorization.notes)}
          </dl>
          {p.authorization.accepted && (
            <div className="actions-left">
              <Link to={`/processos/${p.id}/saida-antecipada`} className="button primary">
                <Icon name="file" /> Ver e imprimir autorização
              </Link>
            </div>
          )}
          <p className="muted small">
            Verificação (QR Code): <Link to={`/verificar/${p.authorization.code}`}>/verificar/{p.authorization.code}</Link>
          </p>
        </section>
      )}

      {canUploadProforma && p.status === 'EM_PROCESSAMENTO_INTERNO' && (
        <section className="card">
          <h3><Icon name="card" /> Carregar proforma</h3>
          <p className="muted">Só o ficheiro é obrigatório: os outros dados já estão no documento.</p>
          {p.authorization && !p.authorization.accepted && (
            <p className="notice">
              <Icon name="alert" /> A saída antecipada aguarda o aceite do transitário: aguarde ou revogue-a antes de enviar a proforma.
            </p>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              const { file, amount, ...rest } = proforma
              post('/proforma', { form: formWith(filled({ ...rest, amount: amount === '' ? null : Number(amount) }), 'proforma', file) })
            }}
          >
            <div className="row">
              <Field label="N.º da proforma (opcional)">
                <input value={proforma.number} onChange={(e) => setProforma({ ...proforma, number: e.target.value })} />
              </Field>
              <Field label="Valor em AOA (opcional)">
                <input type="number" min="0" step="0.01" value={proforma.amount} onChange={(e) => setProforma({ ...proforma, amount: e.target.value })} />
              </Field>
            </div>
            <div className="row">
              <Field label="Entidade de pagamento (opcional)">
                <input value={proforma.paymentEntity} onChange={(e) => setProforma({ ...proforma, paymentEntity: e.target.value })} />
              </Field>
              <Field label="Referência de pagamento (opcional)">
                <input value={proforma.paymentReference} onChange={(e) => setProforma({ ...proforma, paymentReference: e.target.value })} />
              </Field>
            </div>
            {p.authorization?.accepted && (
              <Field label="Data limite de pagamento (saída antecipada)">
                <input type="date" value={proforma.dueDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setProforma({ ...proforma, dueDate: e.target.value })} required />
              </Field>
            )}
            <Field label="Ficheiro da proforma (PDF ou imagem)">
              <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setProforma({ ...proforma, file: e.target.files[0] })} required />
            </Field>
            <div>
              <button className="primary">Enviar proforma ao transitário</button>
            </div>
          </form>
        </section>
      )}

      {p.invoice && (
        <section className="card">
          <h3><Icon name="card" /> Pagamento</h3>
          <dl className="details">
            {row('Proforma carregada', formatDate(p.invoice.proformaIssuedAt))}
            {p.invoice.proformaNumber && row('N.º da proforma', p.invoice.proformaNumber)}
            {p.invoice.amount != null && row('Valor', money(p.invoice.amount, p.invoice.currency))}
            {p.invoice.paymentEntity && row('Entidade de pagamento', p.invoice.paymentEntity)}
            {p.invoice.paymentReference && row('Referência', <code>{p.invoice.paymentReference}</code>)}
            {p.invoice.proofSubmittedAt && row('Comprovativo enviado', formatDate(p.invoice.proofSubmittedAt))}
            {p.invoice.paymentConfirmedAt && row('Pagamento confirmado', formatDate(p.invoice.paymentConfirmedAt))}
            {p.invoice.receiptNumber && row('Fatura recibo', p.invoice.receiptNumber)}
          </dl>

          {isForwarder && p.status === 'PAGAMENTO_PENDENTE' && (
            <div className="stack">
              <p className="muted">Veja a proforma, pague no aplicativo do banco ou no ATM e depois clique em «Já paguei» para enviar o comprovativo.</p>
              <div className="actions-left">
                {proformaDoc && (
                  <button onClick={() => open(proformaDoc)}>
                    <Icon name="file" /> Ver ou descarregar proforma
                  </button>
                )}
                <button className="primary" onClick={() => setPaying(true)}>
                  Já paguei
                </button>
              </div>
            </div>
          )}

          {isForwarder && p.status === 'PAGAMENTO_SUBMETIDO' && (
            <p className="notice">
              <Icon name="clock" /> Comprovativo enviado: as Finanças estão a verificar o pagamento.
            </p>
          )}
          {isForwarder && p.status === 'PAGAMENTO_CONFIRMADO' && (
            <p className="notice">
              <Icon name="clock" /> Pagamento confirmado: aguarde a fatura recibo.
            </p>
          )}

          {receiptDoc && (
            <div className="actions-left">
              <button className="primary" onClick={() => open(receiptDoc)}>
                <Icon name="download" /> Ver ou descarregar fatura recibo
              </button>
            </div>
          )}

          {isFinance && p.status === 'PAGAMENTO_SUBMETIDO' && (
            <div className="stack">
              <p className="muted">Compare o comprovativo do transitário com a proforma antes de decidir.</p>
              <div>
                <button className="primary" onClick={() => setReviewing(true)}>
                  Verificar pagamento
                </button>
              </div>
            </div>
          )}

          {isFinance && p.status === 'PAGAMENTO_CONFIRMADO' && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                post('/receipt', { form: formWith(filled({ number: receipt.number }), 'receipt', receipt.file) })
              }}
            >
              <div className="row">
                <Field label="N.º da fatura recibo (opcional)">
                  <input value={receipt.number} onChange={(e) => setReceipt({ ...receipt, number: e.target.value })} />
                </Field>
                <Field label="Ficheiro (PDF ou imagem)">
                  <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setReceipt({ ...receipt, file: e.target.files[0] })} required />
                </Field>
              </div>
              <div>
                <button className="primary">Enviar fatura recibo e concluir</button>
              </div>
            </form>
          )}
        </section>
      )}

      {isForwarder && PRE_AUTH.includes(p.status) && !earlyRelease && (
        <section className="card stack">
          <h3>
            <Icon name="x" /> Cancelamento
          </h3>
          <p className="muted small">Pode cancelar até os documentos serem aprovados. Depois disso o processo já não pode ser cancelado.</p>
          <div>
            <button className="danger" onClick={() => openDialog('withdraw')}>
              Cancelar processo
            </button>
          </div>
        </section>
      )}

      {ADMINS.includes(user.role) && exceptionActions.length > 0 && (
        <section className="card stack">
          <h3>
            <Icon name="shield" /> Exceções do administrador
          </h3>
          <p className="muted small">Ações excecionais: ficam registadas no histórico e o transitário é notificado.</p>
          <div className="actions-left">
            {exceptionActions.map(([key, label]) => (
              <button key={key} className={DIALOGS[key].danger ? 'danger' : ''} onClick={() => openDialog(key)}>
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {isForwarder && p.status === 'DOCUMENTOS_PENDENTES' && pendingIssues.length > 0 && <CorrectionsToDo key={p.issues.length} process={p} run={run} />}

      <section className="card">
        <h3><Icon name="paperclip" /> Documentos</h3>
        <ul className="docs">
          {p.documents.map((d) => (
            <li key={d.id}>
              <Icon name="file" />
              <button className="link" onClick={() => open(d)}>
                {DOC_LABELS[d.kind]}: {d.originalName}
              </button>
              {pendingIssues.some((i) => i.documentId === d.id) && <span className="tag urgent">Recusado</span>}
              <span className="muted small" style={{ marginLeft: "auto" }}>{formatDate(d.createdAt)}</span>
            </li>
          ))}
        </ul>
        {isForwarder && p.status === 'DOCUMENTOS_PENDENTES' && (
          <>
            <form onSubmit={upload} className="row end">
              <Field label="Outros documentos (pedidos pela Sogester)">
                <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setDocFile(e.target.files[0])} required />
              </Field>
              <button>Anexar</button>
            </form>
            {pendingIssues.length === 0 && (
              <p>
                <button className="primary" onClick={() => run(() => api('POST', `/processes/${id}/submit-documents`))}>
                  Submeter documentos à Sogester
                </button>
              </p>
            )}
          </>
        )}
      </section>

      </div>
      <div>
      <Chat processId={p.id} closed={['CONCLUIDO', 'REJEITADO', 'CANCELADO'].includes(p.status)} onRead={() => window.dispatchEvent(new Event('sogester:unread'))} />
      {viewing && <Viewer path={viewing.path} name={viewing.name} onClose={() => setViewing(null)} />}
      {requesting && (
        <RequestCorrections
          process={p}
          documents={inspectable}
          onClose={() => setRequesting(false)}
          onSubmit={(body) => {
            setRequesting(false)
            run(() => api('POST', `/processes/${id}/transition`, { body: { status: 'DOCUMENTOS_PENDENTES', ...body } }))
          }}
        />
      )}
      {paying && (
        <Modal title="Enviar comprovativo de pagamento" onClose={() => setPaying(false)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              post('/payment-proof', { form: formWith(null, 'proof', proofFile) })
              setProofFile(null)
              setPaying(false)
            }}
          >
            <p className="muted">Sem o comprovativo o processo não avança. As Finanças verificam o pagamento e enviam a fatura recibo.</p>
            <Field label="Comprovativo de pagamento (PDF ou imagem)">
              <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setProofFile(e.target.files[0])} required />
            </Field>
            <div className="actions">
              <button type="button" onClick={() => setPaying(false)}>
                Voltar
              </button>
              <button className="primary">Enviar comprovativo</button>
            </div>
          </form>
        </Modal>
      )}
      {reviewing && (
        <Modal title={`Verificar pagamento — ${p.reference}`} onClose={() => setReviewing(false)} wide="xl">
          <div className="compare">
            <div>
              <h3>Comprovativo do transitário</h3>
              {proofDoc && <DocumentPane path={documentPath(proofDoc)} name={proofDoc.originalName} />}
            </div>
            <div>
              <h3>Proforma</h3>
              {proformaDoc && <DocumentPane path={documentPath(proformaDoc)} name={proformaDoc.originalName} />}
            </div>
          </div>
          <div className="stack">
            <Field label="Motivo (obrigatório para recusar o comprovativo)">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </Field>
            <div className="actions">
              <button disabled={!notes.trim()} onClick={reject}>
                Recusar comprovativo
              </button>
              <button
                className="primary"
                onClick={() => {
                  post('/confirm-payment', { body: {} })
                  setReviewing(false)
                }}
              >
                Confirmar pagamento
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog && (
        <Modal title={DIALOGS[dialog].title} onClose={() => setDialog(null)}>
          <form className="stack" onSubmit={submitDialog}>
            <p className="muted">{DIALOGS[dialog].hint}</p>
            {DIALOGS[dialog].days && (
              <Field label="Dias a acrescentar">
                <select value={dialogDays} onChange={(e) => setDialogDays(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {d} {d === 1 ? 'dia' : 'dias'}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={DIALOGS[dialog].label}>
              <input value={dialogReason} onChange={(e) => setDialogReason(e.target.value)} minLength={5} maxLength={500} required autoFocus />
            </Field>
            <div className="actions">
              <button type="button" onClick={() => setDialog(null)}>
                Voltar
              </button>
              <button className={DIALOGS[dialog].danger ? 'danger' : 'primary'}>{DIALOGS[dialog].confirm}</button>
            </div>
          </form>
        </Modal>
      )}

      <section className="card">
        <h3>
          <Icon name="clock" /> Histórico
        </h3>
        <ol className="history">
          {p.history.map((h, i) => (
            <li key={i}>
              <strong>{historyLabel(h.toStatus)}</strong>
              <div className="muted small">
                {h.changedBy} · {formatDate(h.createdAt)}
              </div>
              {h.notes && <div className="small">{h.notes}</div>}
            </li>
          ))}
        </ol>
      </section>
      </div>
      </div>
    </>
  )
}
