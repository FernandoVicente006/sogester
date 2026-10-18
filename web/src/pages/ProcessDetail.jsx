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
}
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

  useEffect(() => {
    run(() => api('GET', `/processes/${id}`))
  }, [id, run])

  if (!p) return error ? <ErrorBox message={error} /> : <p className="muted">A carregar…</p>

  const isForwarder = user.role === 'TRANSITARIO'
  const actions = REVIEWERS.includes(user.role) ? (STAFF_ACTIONS[p.status] ?? []) : []

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
