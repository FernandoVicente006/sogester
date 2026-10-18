import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBox, formatDate } from './ui.jsx'
import Viewer from './Viewer.jsx'

const POLL_MS = 8000

const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Conversa Sogester ↔ transitário ligada ao processo; atualiza periodicamente e marca como lida. */
export default function Chat({ processId, closed, onRead }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [viewing, setViewing] = useState(null)
  const listRef = useRef(null)
  const fileInput = useRef(null)
  const lastId = useRef(0)
  const base = `/processes/${processId}/messages`

  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  })

  const markRead = useCallback(() => {
    api('POST', `${base}/read`)
      .then(() => onReadRef.current?.())
      .catch(() => {})
  }, [base])

  const load = useCallback(
    async (initial) => {
      try {
        const r = await api('GET', initial ? base : `${base}?after=${lastId.current}`)
        if (initial) {
          setMessages(r.messages)
          setError('')
        } else if (r.messages.length) {
          setMessages((m) => [...m, ...r.messages.filter((n) => !m.some((x) => x.id === n.id))])
        }
        if (r.messages.length) {
          lastId.current = Math.max(lastId.current, ...r.messages.map((m) => m.id))
          if (r.messages.some((m) => m.senderId !== user.id) || initial) markRead()
        } else if (initial) markRead()
      } catch (err) {
        if (initial) setError(errorText(err))
      }
    },
    [base, markRead, user.id],
  )

  useEffect(() => {
    lastId.current = 0
    load(true)
    const timer = setInterval(() => document.visibilityState === 'visible' && load(false), POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length])

  async function send(e) {
    e?.preventDefault()
    if (sending || (!text.trim() && !files.length)) return
    setSending(true)
    setError('')
    const form = new FormData()
    form.append('text', text)
    files.forEach((f) => form.append('files', f))
    try {
      const r = await api('POST', base, { form })
      lastId.current = Math.max(lastId.current, r.message.id)
      setMessages((m) => (m.some((x) => x.id === r.message.id) ? m : [...m, r.message]))
      setText('')
      setFiles([])
      if (fileInput.current) fileInput.current.value = ''
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSending(false)
    }
  }

  const pickFiles = (e) => {
    const picked = [...e.target.files]
    if (picked.length > 3) {
      setError('Máximo de 3 ficheiros por mensagem.')
      e.target.value = ''
      return
    }
    setError('')
    setFiles(picked)
  }

  return (
    <section className="card chat">
      <h3>Conversa</h3>
      <div className="messages" ref={listRef} aria-live="polite">
        {!messages.length && <p className="muted center">Sem mensagens. Use a conversa para pedir ou enviar documentos.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.senderId === user.id ? 'msg mine' : 'msg'}>
            <div className="msg-meta">
              <strong>{m.senderName}</strong> <span className="muted">· {m.side === 'SOGESTER' ? 'Sogester' : 'Transitário'} · {formatDate(m.createdAt)}</span>
            </div>
            {m.body && <p>{m.body}</p>}
            {m.attachments.map((a) => (
              <button key={a.id} className="attachment" onClick={() => setViewing({ path: `${base}/${m.id}/attachments/${a.id}`, name: a.originalName })}>
                📎 {a.originalName} <span className="muted">({formatSize(a.sizeBytes)})</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <ErrorBox message={error} />
      {closed ? (
        <p className="muted small">Processo encerrado: a conversa é só de leitura.</p>
      ) : (
        <form onSubmit={send} className="composer">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(e)
            }}
            placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter nova linha)"
            rows={2}
            maxLength={4000}
          />
          <div className="composer-bar">
            <input ref={fileInput} type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={pickFiles} aria-label="Anexos" />
            <button className="primary" disabled={sending || (!text.trim() && !files.length)}>
              {sending ? 'A enviar…' : 'Enviar'}
            </button>
          </div>
        </form>
      )}
      {viewing && <Viewer path={viewing.path} name={viewing.name} onClose={() => setViewing(null)} />}
    </section>
  )
}
