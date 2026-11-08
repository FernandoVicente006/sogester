import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { api, errorText } from '../api.js'
import { ErrorBox, Icon, formatDate } from '../components/ui.jsx'

/** Autorização de saída antecipada para imprimir: o QR Code abre a verificação, que a portaria confirma no sistema. */
export default function EarlyRelease() {
  const { id } = useParams()
  const [p, setP] = useState(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', `/processes/${id}`)
      .then((r) => setP(r.process))
      .catch((err) => setError(errorText(err)))
  }, [id])

  const verifyUrl = p?.authorization ? `${window.location.origin}/verificar/${p.authorization.code}` : ''
  useEffect(() => {
    if (!verifyUrl) return
    QRCode.toDataURL(verifyUrl, { margin: 1, width: 300, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setError('Não foi possível gerar o QR Code'))
  }, [verifyUrl])

  if (error) return <ErrorBox message={error} />
  if (!p) return <p className="muted">A carregar…</p>
  const a = p.authorization
  if (!a?.accepted) {
    return (
      <>
        <Link to={`/processos/${id}`} className="crumb">
          <Icon name="back" /> {p.reference}
        </Link>
        <p className="notice">A autorização só pode ser impressa depois de o transitário aceitar o compromisso de pagamento.</p>
      </>
    )
  }

  return (
    <>
      <div className="no-print page-head">
        <Link to={`/processos/${id}`} className="crumb">
          <Icon name="back" /> {p.reference}
        </Link>
        <div className="spacer">
          <button className="primary" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </div>
      <article className="release-doc">
        <header>
          <div>
            <img src="/logo-sogester.png" alt="Sogester" />
            <h1>Autorização de saída antecipada</h1>
            <p className="muted small">Sociedade Gestora de Terminais, S.A. · {p.entityCode}</p>
          </div>
          <div className="qr">
            {qr && <img src={qr} alt={`QR Code de verificação ${a.code}`} />}
            <div className="code">{a.code}</div>
          </div>
        </header>

        <p className="reason">
          <strong>Motivo:</strong> {a.reason}
        </p>

        <dl className="details">
          <dt>Processo</dt>
          <dd>{p.reference}</dd>
          <dt>Transitário</dt>
          <dd>{p.forwarderName}</dd>
          <dt>Cliente</dt>
          <dd>{p.client.name}</dd>
          <dt>B/L · DU</dt>
          <dd>
            {p.blNumber ?? '—'} · {p.duNumber ?? '—'}
          </dd>
          <dt>Navio / viagem</dt>
          <dd>{p.vesselName ? `${p.vesselName} · ${p.voyageNumber}` : '—'}</dd>
          <dt>Emitida por</dt>
          <dd>
            {a.issuedBy} · {formatDate(a.issuedAt)}
          </dd>
          <dt>Válida até</dt>
          <dd>{a.validUntil ? formatDate(a.validUntil) : '—'}</dd>
        </dl>

        {p.vehicles.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Veículo</th>
                <th>Chassi</th>
              </tr>
            </thead>
            <tbody>
              {p.vehicles.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.brand} {v.model}
                  </td>
                  <td>{v.chassis ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {p.containers.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Contentor</th>
                <th>Pés</th>
                <th>Selo</th>
              </tr>
            </thead>
            <tbody>
              {p.containers.map((c) => (
                <tr key={c.id}>
                  <td>{c.number}</td>
                  <td>{c.size ? `${c.size}'` : '—'}</td>
                  <td>{c.seal ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {p.goods.length > 0 && (
          <p className="small">
            <strong>Mercadorias:</strong> {p.goods.map((g) => `${g.quantity} ${g.unit} de ${g.description}`).join('; ')}
          </p>
        )}

        <footer>
          Vale para uma única saída, dentro da validade. A portaria confirma o código no sistema da Sogester ({verifyUrl}): uma
          cópia ou alteração deste papel não é aceite. O pagamento continua devido nos termos do compromisso aceite por{' '}
          {p.commitment?.signedBy} em {formatDate(p.commitment?.signedAt)}.
        </footer>
      </article>
    </>
  )
}
