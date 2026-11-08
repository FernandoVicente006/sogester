import { useState } from 'react'
import { api } from '../api.js'
import { Field, Icon, Modal } from './ui.jsx'

/** Campos que a Loja pode marcar como errados (espelha o servidor). */
export const FIELD_LABELS = {
  blNumber: 'N.º do B/L',
  duNumber: 'N.º do DU',
  vesselName: 'Navio',
  voyageNumber: 'N.º da viagem',
  dischargeType: 'Tipo de descarga',
  regime: 'Regime',
  manifestNumber: 'N.º do manifesto',
  weightKg: 'Peso bruto (kg)',
  packagesCount: 'N.º de volumes',
  originCountry: 'País de origem',
  destinationCountry: 'País de destino',
  description: 'Descrição geral',
}
const NUMERIC_FIELDS = ['weightKg', 'packagesCount']

/** Documentos que o transitário pode enviar (os de faturação entram pelos seus próprios passos). */
export const UPLOADABLE_LABELS = {
  EP17: 'EP17',
  EP15: 'EP15',
  RECIBO_EP: 'Recibo do EP',
  DOCUMENTOS: 'Documentação',
  ALVARA: 'Alvará comercial',
  BILHETE: 'Bilhete de identidade',
  GUIA_CABOTAGEM: 'Guia de cabotagem',
  BL: 'BL',
  OUTRO: 'Outro',
}

export const openIssues = (process) => (process.issues ?? []).filter((i) => !i.closedAt)

/** Loja: escolhe os documentos recusados, os que faltam e os campos errados, cada um com o motivo. */
export function RequestCorrections({ process, documents, onClose, onSubmit }) {
  const [rejected, setRejected] = useState({}) // documentId -> motivo
  const [missing, setMissing] = useState([])
  const [fields, setFields] = useState([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const issues = [
    ...Object.entries(rejected).map(([documentId, reason]) => ({ kind: 'DOCUMENTO', documentId: Number(documentId), reason })),
    ...missing.map((m) => ({ kind: 'EM_FALTA', documentKind: m.documentKind, reason: m.reason })),
    ...fields.map((f) => ({ kind: 'CAMPO', field: f.field, reason: f.reason })),
  ]
  const editRow = (list, setList, i, key, value) => setList(list.map((r, j) => (j === i ? { ...r, [key]: value } : r)))

  function submit(e) {
    e.preventDefault()
    if (!issues.length && !notes.trim()) return setError('Indique pelo menos uma correção ou uma observação.')
    if (issues.some((i) => !i.reason?.trim())) return setError('Cada correção precisa de um motivo.')
    onSubmit({ issues, notes: notes.trim() || undefined })
  }

  return (
    <Modal title={`Pedir correções — ${process.reference}`} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <p className="muted">O transitário vê só o que marcar aqui e reenvia cada correção. Tudo fica no histórico.</p>

        <h4>Documentos recusados</h4>
        <ul className="docs">
          {documents.map((d) => (
            <li key={d.id} className="correction-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.id in rejected}
                  onChange={(e) =>
                    setRejected((r) => {
                      const next = { ...r }
                      if (e.target.checked) next[d.id] = ''
                      else delete next[d.id]
                      return next
                    })
                  }
                />
                {UPLOADABLE_LABELS[d.kind] ?? d.kind}: {d.originalName}
              </label>
              {d.id in rejected && (
                <input
                  placeholder="Motivo (ex.: ilegível, fora do prazo)"
                  value={rejected[d.id]}
                  onChange={(e) => setRejected((r) => ({ ...r, [d.id]: e.target.value }))}
                  maxLength={300}
                  required
                  aria-label="Motivo"
                />
              )}
            </li>
          ))}
        </ul>

        <div className="items-head">
          <h4>Documentos em falta</h4>
          <button type="button" onClick={() => setMissing([...missing, { documentKind: 'OUTRO', reason: '' }])}>
            <Icon name="plus" /> Documento
          </button>
        </div>
        {missing.map((m, i) => (
          <div key={i} className="row end">
            <Field label="Documento">
              <select value={m.documentKind} onChange={(e) => editRow(missing, setMissing, i, 'documentKind', e.target.value)}>
                {Object.entries(UPLOADABLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motivo">
              <input value={m.reason} onChange={(e) => editRow(missing, setMissing, i, 'reason', e.target.value)} maxLength={300} required />
            </Field>
            <button type="button" className="icon-btn" onClick={() => setMissing(missing.filter((_, j) => j !== i))} aria-label="Remover">
              <Icon name="x" />
            </button>
          </div>
        ))}

        <div className="items-head">
          <h4>Campos errados</h4>
          <button type="button" onClick={() => setFields([...fields, { field: 'duNumber', reason: '' }])}>
            <Icon name="plus" /> Campo
          </button>
        </div>
        {fields.map((f, i) => (
          <div key={i} className="row end">
            <Field label={`Campo (valor atual: ${process[f.field] ?? '—'})`}>
              <select value={f.field} onChange={(e) => editRow(fields, setFields, i, 'field', e.target.value)}>
                {Object.entries(FIELD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motivo">
              <input value={f.reason} onChange={(e) => editRow(fields, setFields, i, 'reason', e.target.value)} maxLength={300} required />
            </Field>
            <button type="button" className="icon-btn" onClick={() => setFields(fields.filter((_, j) => j !== i))} aria-label="Remover">
              <Icon name="x" />
            </button>
          </div>
        ))}

        <Field label="Observação geral (opcional)">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Voltar
          </button>
          <button className="primary">Enviar pedido ao transitário ({issues.length})</button>
        </div>
      </form>
    </Modal>
  )
}

/** Transitário: cada correção pedida, com o envio do documento ou do valor corrigido, e o reenvio no fim. */
export function CorrectionsToDo({ process, run }) {
  const issues = openIssues(process)
  const [files, setFiles] = useState({})
  const [values, setValues] = useState(() => Object.fromEntries(issues.filter((i) => i.kind === 'CAMPO').map((i) => [i.field, process[i.field] ?? ''])))
  const pending = issues.filter((i) => !i.fixedAt).length

  const sendFile = (issue) => {
    const form = new FormData()
    form.append('kind', issue.documentKind)
    form.append('file', files[issue.id])
    run(() => api('POST', `/processes/${process.id}/documents`, { form }))
  }
  const sendField = (issue) => {
    const raw = values[issue.field]
    const value = NUMERIC_FIELDS.includes(issue.field) ? Number(raw) : raw
    run(() => api('PATCH', `/processes/${process.id}/fields`, { body: { [issue.field]: value } }))
  }

  return (
    <section className="card stack">
      <h3>
        <Icon name="alert" /> Correções pedidas pela Sogester
      </h3>
      <p className="muted small">Corrija cada ponto e reenvie. {pending ? `Faltam ${pending}.` : 'Tudo corrigido.'}</p>
      <ul className="corrections">
        {issues.map((issue) => (
          <li key={issue.id} className={issue.fixedAt ? 'done' : ''}>
            <div>
              <strong>{issue.label}</strong>
              <div className="small">Motivo: {issue.reason}</div>
              {issue.fixedAt && (
                <div className="small ok-text">
                  <Icon name="check" /> Corrigido{issue.newValue ? `: ${issue.oldValue ?? '—'} → ${issue.newValue}` : ''}
                </div>
              )}
            </div>
            {issue.kind === 'CAMPO' ? (
              <div className="row end">
                {issue.field === 'dischargeType' ? (
                  <select value={values[issue.field]} onChange={(e) => setValues({ ...values, [issue.field]: e.target.value })} aria-label={issue.label}>
                    <option value="DIRECTA">Directa</option>
                    <option value="INDIRECTA">Indirecta</option>
                  </select>
                ) : (
                  <input
                    type={NUMERIC_FIELDS.includes(issue.field) ? 'number' : 'text'}
                    value={values[issue.field]}
                    onChange={(e) => setValues({ ...values, [issue.field]: e.target.value })}
                    aria-label={issue.label}
                  />
                )}
                <button type="button" disabled={values[issue.field] === ''} onClick={() => sendField(issue)}>
                  Guardar
                </button>
              </div>
            ) : (
              <div className="row end">
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => setFiles({ ...files, [issue.id]: e.target.files[0] })}
                  aria-label={`Ficheiro para ${issue.label}`}
                />
                <button type="button" disabled={!files[issue.id]} onClick={() => sendFile(issue)}>
                  Enviar {UPLOADABLE_LABELS[issue.documentKind]}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div>
        <button className="primary" disabled={pending > 0} onClick={() => run(() => api('POST', `/processes/${process.id}/submit-documents`))}>
          Reenviar à Sogester
        </button>
      </div>
    </section>
  )
}
