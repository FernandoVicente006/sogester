import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { ErrorBox, formatDate } from '../components/ui.jsx'

/** Verificação pública de uma autorização digital (sem sessão): confirma autenticidade sem expor dados do cliente. */
export default function Verify() {
  const { code } = useParams()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', `/verify/authorization/${encodeURIComponent(code)}`)
      .then(setResult)
      .catch((err) => setError(errorText(err)))
  }, [code])

  return (
    <div className="card auth">
      <h1>Verificar autorização</h1>
      <p className="muted">
        Código <code>{code}</code>
      </p>
      <ErrorBox message={error} />
      {result && !result.valid && <p className="error">Código inválido: esta autorização não foi emitida pela Sogester.</p>}
      {result?.valid && (
        <>
          <p className="ok">✔ Autorização autêntica</p>
          <dl className="details">
            <dt>Processo</dt>
            <dd>{result.reference}</dd>
            <dt>Entidade</dt>
            <dd>{result.entity}</dd>
            <dt>Transitário</dt>
            <dd>{result.forwarder}</dd>
            <dt>Tipo</dt>
            <dd>{result.type === 'SAIDA_ANTECIPADA' ? 'Saída antecipada' : 'Padrão'}</dd>
            <dt>Emitida em</dt>
            <dd>{formatDate(result.issuedAt)}</dd>
            <dt>Pagamento</dt>
            <dd>{result.paymentSettled ? 'Liquidado' : 'Pendente'}</dd>
          </dl>
        </>
      )}
      <p className="muted small">
        <Link to="/login">Sogester</Link>
      </p>
    </div>
  )
}
