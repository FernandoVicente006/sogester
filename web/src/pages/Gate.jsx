import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { ErrorBox, Field, PageHeader, formatDate } from '../components/ui.jsx'

const STATE_LABELS = {
  VALIDA: 'Válida: pode sair',
  USADA: 'Já usada: não deixar sair',
  EXPIRADA: 'Expirada: não deixar sair',
  REVOGADA: 'Revogada: não deixar sair',
  AGUARDA_ACEITE: 'Sem aceite do transitário: não deixar sair',
}

/** Portaria: lê o código (ou o QR Code, que abre a verificação), confere a carga e regista a saída. */
export default function Gate() {
  const [params, setParams] = useSearchParams()
  const [code, setCode] = useState(params.get('codigo') ?? '')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const lookup = useCallback(async (value) => {
    setError('')
    setResult(null)
    try {
      setResult(await api('GET', `/gate/authorization/${encodeURIComponent(value.trim().toUpperCase())}`))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    const initial = params.get('codigo')
    if (initial) lookup(initial)
  }, [params, lookup])

  async function registerExit() {
    setBusy(true)
    setError('')
    try {
      setResult(await api('POST', `/gate/authorization/${encodeURIComponent(code.trim().toUpperCase())}/use`))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Portaria" subtitle="Confirme a autorização de saída antecipada antes de deixar sair a carga." />
      <form
        className="card row end"
        onSubmit={(e) => {
          e.preventDefault()
          setParams({ codigo: code.trim().toUpperCase() })
        }}
      >
        <Field label="Código da autorização (AUT-XXXX-XXXX-XXXX)">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="AUT-…" autoFocus required />
        </Field>
        <button className="primary">Verificar</button>
      </form>
      <ErrorBox message={error} />

      {result && (
        <section className="card stack">
          <p className={result.state === 'VALIDA' ? 'gate-state VALIDA' : 'gate-state bad'}>{STATE_LABELS[result.state] ?? result.state}</p>
          <dl className="details">
            <dt>Processo</dt>
            <dd>{result.reference}</dd>
            <dt>Transitário</dt>
            <dd>{result.forwarder}</dd>
            <dt>Cliente</dt>
            <dd>{result.cargo.client}</dd>
            <dt>B/L · DU</dt>
            <dd>
              {result.cargo.blNumber ?? '—'} · {result.cargo.duNumber ?? '—'}
            </dd>
            <dt>Navio</dt>
            <dd>{result.cargo.vessel ?? '—'}</dd>
            {result.validUntil && (
              <>
                <dt>Válida até</dt>
                <dd>{formatDate(result.validUntil)}</dd>
              </>
            )}
            {result.usedAt && (
              <>
                <dt>Saída registada</dt>
                <dd>{formatDate(result.usedAt)}</dd>
              </>
            )}
          </dl>
          {result.cargo.vehicles.length > 0 && (
            <p>
              <strong>Veículos:</strong> {result.cargo.vehicles.map((v) => `${v.name} (chassi ${v.chassis ?? '—'})`).join('; ')}
            </p>
          )}
          {result.cargo.containers.length > 0 && (
            <p>
              <strong>Contentores:</strong> {result.cargo.containers.map((c) => `${c.number}${c.size ? ` (${c.size}')` : ''}`).join('; ')}
            </p>
          )}
          {result.cargo.goods.length > 0 && (
            <p>
              <strong>Mercadorias:</strong> {result.cargo.goods.join('; ')}
            </p>
          )}
          {result.state === 'VALIDA' && (
            <div>
              <button className="primary" disabled={busy} onClick={registerExit}>
                Confirmar e registar a saída
              </button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
