import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText, openDocument } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBox, Field, PROCESS_STATUS_LABELS, ProcessBadge, formatDate } from '../components/ui.jsx'

const DOC_LABELS = {
  BILHETE: 'Bilhete de identidade',
  ALVARA: 'Alvará comercial',
  GUIA_CABOTAGEM: 'Guia de cabotagem',
  BL: 'BL',
  EP17: 'EP17',
  EP15: 'EP15',
  OUTRO: 'Outro',
  PROFORMA: 'Fatura proforma',
  COMPROVATIVO: 'Comprovativo de pagamento',
  FATURA_RECIBO: 'Fatura recibo',
}
const PRE_AUTHORIZATION = ['SUBMETIDO', 'EM_ANALISE', 'DOCUMENTOS_PENDENTES', 'DOCUMENTOS_SUBMETIDOS']
const AUTHORIZERS = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'LOJA']
const BILLERS = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'FATURACAO']
const money = (amount, currency) => new Intl.NumberFormat('pt-AO', { style: 'currency', currency }).format(amount)
const VOLUME_LABELS = { ALTO: 'Alto', CARGA_GRANEL: 'Carga granel', CARGA_GERAL: 'Carga geral', CONTENTOR: 'Contentor' }
const PRIORITY_LABELS = { PERECIVEL: 'Perecível', CARGA_PERIGOSA: 'Carga perigosa', DESCARGA_DIRETA: 'Descarga direta', NAO_PRIORITARIO: 'Não prioritário' }

// Transições que a Sogester pode fazer a partir de cada estado (espelha o servidor).
const STAFF_ACTIONS = {
  SUBMETIDO: [['EM_ANALISE', 'Iniciar análise'], ['REJEITADO', 'Rejeitar']],
  EM_ANALISE: [['DOCUMENTOS_PENDENTES', 'Pedir documentos'], ['REJEITADO', 'Rejeitar']],
  DOCUMENTOS_SUBMETIDOS: [['EM_ANALISE', 'Voltar à análise'], ['DOCUMENTOS_PENDENTES', 'Pedir documentos'], ['REJEITADO', 'Rejeitar']],
}
const NOTES_REQUIRED = ['DOCUMENTOS_PENDENTES', 'REJEITADO']
const REVIEWERS = ['SUPER_ADMIN', 'ADMIN_ENTIDADE', 'LOJA']

export default function ProcessDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [p, setP] = useState(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const [docKind, setDocKind] = useState('OUTRO')
  const [docFile, setDocFile] = useState(null)

  const run = useCallback(async (fn) => {
    setError('')
    try {
      setP((await fn()).process)
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  const [terms, setTerms] = useState(null)
  const [sign, setSign] = useState({ password: '', accept: false })
  const [proforma, setProforma] = useState({ number: '', amount: '', paymentEntity: '', paymentReference: '', file: null })
  const [receipt, setReceipt] = useState({ number: '', file: null })
  const [proofFile, setProofFile] = useState(null)

  useEffect(() => {
    run(() => api('GET', `/processes/${id}`))
  }, [id, run])

  const needsCommitment =
    user.role === 'TRANSITARIO' && p?.cargoPriority === 'PERECIVEL' && !p.hasCommitment && PRE_AUTHORIZATION.includes(p.status)
  useEffect(() => {
    if (!needsCommitment) return
    api('GET', `/processes/${id}/commitment-terms`)
      .then(setTerms)
      .catch((err) => setError(errorText(err)))
  }, [needsCommitment, id])

  if (!p) return error ? <ErrorBox message={error} /> : <p className="muted">A carregar…</p>

  const isForwarder = user.role === 'TRANSITARIO'
  const actions = REVIEWERS.includes(user.role) ? (STAFF_ACTIONS[p.status] ?? []) : []
  const canAuthorize = AUTHORIZERS.includes(user.role) && ['EM_ANALISE', 'DOCUMENTOS_SUBMETIDOS'].includes(p.status)
  const isBiller = BILLERS.includes(user.role)
  const post = (path, options) => run(() => api('POST', `/processes/${id}${path}`, options))
  const formWith = (data, fileField, file) => {
    const f = new FormData()
    if (data) f.append('data', JSON.stringify(data))
    f.append(fileField, file)
    return f
  }

  const transition = (status) => {
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
    form.append('kind', docKind)
    form.append('file', docFile)
    run(() => api('POST', `/processes/${id}/documents`, { form }))
    setDocFile(null)
    e.target.reset()
  }

  const open = async (doc) => {
    try {
      await openDocument(`/processes/${id}/documents/${doc.id}`)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const row = (label, value) => (
    <>
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </>
  )

  return (
    <>
      <p>
        <Link to="/processos">← Processos</Link>
      </p>
      <div className="toolbar">
        <h2>{p.reference}</h2>
        <ProcessBadge status={p.status} />
      </div>
      <ErrorBox message={error} />
      {p.statusNotes && ['DOCUMENTOS_PENDENTES', 'REJEITADO'].includes(p.status) && (
        <p className="notice">
          <strong>Sogester:</strong> {p.statusNotes}
        </p>
      )}

      <section className="card">
        <h3>Detalhes</h3>
        <dl className="details">
          {row('Terminal', p.entityCode)}
          {row('Transitário', p.forwarderName)}
          {row('Cliente', `${p.client.name} (${p.client.type === 'SINGULAR' ? 'singular' : 'empresa'}${p.client.isForeign ? ', estrangeira' : ''})`)}
          {row('Documento do cliente', p.client.documentNumber)}
          {row('Prioridade', PRIORITY_LABELS[p.cargoPriority])}
          {p.urgencyRequested && row('Urgência', p.urgencyReason)}
          {row('Tipo de volume', VOLUME_LABELS[p.volumeType])}
          {p.cargoCategory && row('Tipo de carga', p.cargoCategory)}
          {p.vehicleBrand && row('Veículo', `${p.vehicleBrand} ${p.vehicleModel}`)}
          {p.description && row('Descrição', p.description)}
          {p.quantity != null && row('Quantidade', p.quantity)}
          {p.weightKg != null && row('Peso (kg)', p.weightKg)}
          {p.containerPlate && row('Contentor', `${p.containerPlate} · ${p.containerType} · ${p.containerVolume} m³ · ${p.containerWeightKg} kg`)}
          {row('Submetido em', formatDate(p.submittedAt))}
        </dl>
      </section>

      {actions.length > 0 && (
        <section className="card stack">
          <h3>Análise</h3>
          <Field label="Motivo / documentos em falta (obrigatório ao pedir documentos ou rejeitar)">
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
          <h3>Compromisso de pagamento</h3>
          <p className="muted">
            Carga perecível: para a Sogester emitir a autorização de saída sem esperar todo o ciclo de faturação, assine o
            compromisso abaixo.
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
              Assinar compromisso
            </button>
          </form>
        </section>
      )}

      {p.commitment && (
        <p className={p.paymentOverdue ? 'notice danger' : 'notice'}>
          Compromisso de pagamento assinado por {p.commitment.signedBy} em {formatDate(p.commitment.signedAt)}.
          {p.commitment.dueAt && ` Prazo para liquidar: ${formatDate(p.commitment.dueAt)}.`}
          {p.paymentOverdue && ' PAGAMENTO EM ATRASO.'}
        </p>
      )}

      {canAuthorize && (
        <section className="card stack">
          <h3>Autorização digital</h3>
          {p.cargoPriority === 'PERECIVEL' && !p.hasCommitment ? (
            <p className="muted">Carga perecível: aguarda o compromisso de pagamento assinado pelo transitário.</p>
          ) : (
            <p className="muted">
              {p.cargoPriority === 'PERECIVEL'
                ? 'Emite a autorização de saída antecipada (compromisso assinado).'
                : 'Documentação conforme: emite o termo de autorização para avançar para a faturação.'}
            </p>
          )}
          <div>
            <button
              className="primary"
              disabled={p.cargoPriority === 'PERECIVEL' && !p.hasCommitment}
              onClick={() => post('/authorization', { body: {} })}
            >
              Enviar aprovação digital
            </button>
          </div>
        </section>
      )}

      {p.authorization && (
        <section className="card">
          <h3>Autorização digital</h3>
          <dl className="details">
            {row('Código', <code>{p.authorization.code}</code>)}
            {row('Tipo', p.authorization.type === 'SAIDA_ANTECIPADA' ? 'Saída antecipada (compromisso de pagamento)' : 'Padrão')}
            {row('Emitida por', `${p.authorization.issuedBy} · ${formatDate(p.authorization.issuedAt)}`)}
            {p.authorization.notes && row('Notas', p.authorization.notes)}
          </dl>
          <p className="muted small">
            Verificação pública: <Link to={`/verificar/${p.authorization.code}`}>/verificar/{p.authorization.code}</Link>
          </p>
        </section>
      )}

      {isBiller && p.status === 'AUTORIZACAO_EMITIDA' && (
        <section className="card">
          <h3>Emitir proforma</h3>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              const { file, amount, ...rest } = proforma
              post('/proforma', { form: formWith({ ...rest, amount: Number(amount) }, 'proforma', file) })
            }}
          >
            <div className="row">
              <Field label="N.º da proforma">
                <input value={proforma.number} onChange={(e) => setProforma({ ...proforma, number: e.target.value })} required />
              </Field>
              <Field label="Valor (AOA)">
                <input type="number" min="0" step="0.01" value={proforma.amount} onChange={(e) => setProforma({ ...proforma, amount: e.target.value })} required />
              </Field>
            </div>
            <div className="row">
              <Field label="Entidade de pagamento">
                <input value={proforma.paymentEntity} onChange={(e) => setProforma({ ...proforma, paymentEntity: e.target.value })} required />
              </Field>
              <Field label="Referência de pagamento">
                <input value={proforma.paymentReference} onChange={(e) => setProforma({ ...proforma, paymentReference: e.target.value })} required />
              </Field>
            </div>
            <Field label="Ficheiro da proforma (PDF ou imagem)">
              <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setProforma({ ...proforma, file: e.target.files[0] })} required />
            </Field>
            <div>
              <button className="primary">Emitir proforma</button>
            </div>
          </form>
        </section>
      )}

      {p.invoice && (
        <section className="card">
          <h3>Faturação</h3>
          <dl className="details">
            {row('Proforma', p.invoice.proformaNumber)}
            {row('Valor', money(p.invoice.amount, p.invoice.currency))}
            {row('Entidade de pagamento', p.invoice.paymentEntity)}
            {row('Referência', <code>{p.invoice.paymentReference}</code>)}
            {p.invoice.proofSubmittedAt && row('Comprovativo enviado', formatDate(p.invoice.proofSubmittedAt))}
            {p.invoice.paymentConfirmedAt && row('Pagamento confirmado', formatDate(p.invoice.paymentConfirmedAt))}
            {p.invoice.receiptNumber && row('Fatura recibo', p.invoice.receiptNumber)}
          </dl>

          {isForwarder && p.status === 'PAGAMENTO_PENDENTE' && (
            <form
              className="row end"
              onSubmit={(e) => {
                e.preventDefault()
                post('/payment-proof', { form: formWith(null, 'proof', proofFile) })
                setProofFile(null)
                e.target.reset()
              }}
            >
              <Field label="Comprovativo de pagamento (PDF ou imagem)">
                <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setProofFile(e.target.files[0])} required />
              </Field>
              <button className="primary">Carregar comprovativo</button>
            </form>
          )}

          {isBiller && p.status === 'PAGAMENTO_SUBMETIDO' && (
            <div className="stack">
              <Field label="Motivo (obrigatório para recusar o comprovativo)">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
              </Field>
              <div className="actions-left">
                <button className="primary" onClick={() => post('/confirm-payment', { body: {} })}>
                  Confirmar pagamento
                </button>
                <button
                  onClick={() => {
                    if (!notes.trim()) return setError('Indique o motivo para recusar o comprovativo.')
                    post('/reject-payment', { body: { notes: notes.trim() } })
                    setNotes('')
                  }}
                >
                  Recusar comprovativo
                </button>
              </div>
            </div>
          )}

          {isBiller && p.status === 'PAGAMENTO_CONFIRMADO' && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                post('/receipt', { form: formWith({ number: receipt.number }, 'receipt', receipt.file) })
              }}
            >
              <div className="row">
                <Field label="N.º da fatura recibo">
                  <input value={receipt.number} onChange={(e) => setReceipt({ ...receipt, number: e.target.value })} required />
                </Field>
                <Field label="Ficheiro (PDF ou imagem)">
                  <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setReceipt({ ...receipt, file: e.target.files[0] })} required />
                </Field>
              </div>
              <div>
                <button className="primary">Emitir fatura recibo e concluir</button>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="card">
        <h3>Documentos</h3>
        <ul className="docs">
          {p.documents.map((d) => (
            <li key={d.id}>
              <button className="link" onClick={() => open(d)}>
                {DOC_LABELS[d.kind]}: {d.originalName}
              </button>
              <span className="muted small"> · {formatDate(d.createdAt)}</span>
            </li>
          ))}
        </ul>
        {isForwarder && p.status === 'DOCUMENTOS_PENDENTES' && (
          <>
            <form onSubmit={upload} className="row end">
              <Field label="Tipo">
                <select value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                  {Object.entries(DOC_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ficheiro">
                <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setDocFile(e.target.files[0])} required />
              </Field>
              <button>Anexar</button>
            </form>
            <p>
              <button className="primary" onClick={() => run(() => api('POST', `/processes/${id}/submit-documents`))}>
                Submeter documentos à Sogester
              </button>
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h3>Histórico</h3>
        <ol className="history">
          {p.history.map((h, i) => (
            <li key={i}>
              <strong>{PROCESS_STATUS_LABELS[h.toStatus]}</strong> · {h.changedBy} ·{' '}
              <span className="muted">{formatDate(h.createdAt)}</span>
              {h.notes && <div className="muted">{h.notes}</div>}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
