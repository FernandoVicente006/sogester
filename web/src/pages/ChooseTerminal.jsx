import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBox, Icon } from '../components/ui.jsx'

const STATUS = {
  PENDENTE: 'Aguarda aprovação da Sogester',
  REJEITADO: 'Pedido recusado',
  SUSPENSO: 'Acesso suspenso',
}

/**
 * Depois de entrar, o transitário escolhe o terminal onde vai trabalhar (como a escolha entre JUP e Portal).
 * A sessão fica limitada a esse terminal até trocar.
 */
export default function ChooseTerminal() {
  const { user, loading, selectTerminal, logout } = useAuth()
  const navigate = useNavigate()
  const [terminals, setTerminals] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    if (user?.role !== 'TRANSITARIO') return
    api('GET', '/auth/terminals')
      .then((r) => setTerminals(r.terminals))
      .catch((err) => setError(errorText(err)))
  }, [user])

  if (loading) return <p className="center muted">A carregar…</p>
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'TRANSITARIO') return <Navigate to="/" replace />

  async function enter(t) {
    setBusy(t.id)
    setError('')
    try {
      await selectTerminal(t.id)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  const open = terminals?.filter((t) => t.open) ?? []
  return (
    <div className="auth-solo">
      <div className="choose-wrap">
      <img src="/logo-sogester.png" alt="Sogester" className="brand-logo choose-logo" />
      <div className="choose-terminal">
        <div>
          <h1>Escolha o terminal</h1>
          <p className="muted">
            Olá, {user.name}. Escolha onde vai trabalhar; pode trocar de terminal mais tarde no menu, sem voltar a introduzir a
            palavra-passe.
          </p>
        </div>
        <ErrorBox message={error} />
        {!terminals && !error && <p className="muted">A carregar…</p>}
        {terminals && !open.length && (
          <p className="notice">
            {terminals.some((t) => t.status === 'APROVADO')
              ? 'Os terminais onde está aprovado estão indisponíveis de momento. Contacte a Sogester.'
              : 'Ainda não está aprovado em nenhum terminal. Contacte a Sogester para validar o seu registo.'}
          </p>
        )}
        <div className="terminal-cards">
          {terminals?.map((t) => {
            const note = !t.active ? 'Terminal indisponível' : STATUS[t.status]
            return (
              <button
                key={t.id}
                type="button"
                className={user.terminal?.id === t.id ? 'terminal-card current' : 'terminal-card'}
                disabled={!t.open || busy !== null}
                onClick={() => enter(t)}
              >
                <Icon name="building" />
                <span className="terminal-card-text">
                  <strong>{t.name}</strong>
                  <span className="muted small">{t.location}</span>
                  {note && <span className="small terminal-card-note">{note}</span>}
                  {user.terminal?.id === t.id && <span className="small ok-text">Terminal atual</span>}
                </span>
                {t.open && <span className="terminal-card-go">{busy === t.id ? 'A entrar…' : 'Entrar'}</span>}
              </button>
            )
          })}
        </div>
        <button type="button" className="link" onClick={logout}>
          <Icon name="logout" /> Terminar sessão
        </button>
      </div>
      </div>
    </div>
  )
}
