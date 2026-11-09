import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText, getToken } from '../api.js'
import { ErrorBox, formatDate } from '../components/ui.jsx'

const STATE_TEXT = {
  INVALIDA: 'Código inválido: esta autorização não foi emitida pela Sogester.',
  REVOGADA: 'Autorização revogada pela Sogester: não permite a saída.',
  AGUARDA_ACEITE: 'Autorização ainda sem o aceite do transitário: não permite a saída.',
  USADA: 'Autorização já usada: vale para uma única saída.',
  EXPIRADA: 'Autorização expirada: não permite a saída.',
}

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
    <div className="auth-solo"><div className="auth">
      <h1>Verificar autorização</h1>
      <p className="muted">
        Código <code>{code}</code>
      </p>
      <ErrorBox message={error} />
      {result && !result.valid && <p className="error">{STATE_TEXT[result.state] ?? STATE_TEXT.INVALIDA}</p>}
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
            {result.validUntil && (
              <>
                <dt>Válida até</dt>
                <dd>{formatDate(result.validUntil)}</dd>
              </>
            )}
            <dt>Pagamento</dt>
            <dd>{result.paymentSettled ? 'Liquidado' : 'Pendente'}</dd>
          </dl>
        </>
      )}
      <p>
        {getToken() ? (
          <Link className="button" to={`/portaria?codigo=${encodeURIComponent(code)}`}>
            Abrir na portaria
          </Link>
        ) : (
          <Link className="button" to={`/login?voltar=${encodeURIComponent(`/portaria?codigo=${code}`)}`}>
            Portaria: entrar para registar a saída
          </Link>
        )}
      </p>
      <p className="muted small">
        <Link to="/login">Sogester</Link>
      </p>
    </div></div>
  )
}
