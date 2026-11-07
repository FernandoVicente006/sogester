import { useEffect, useState } from 'react'
import { errorText, fetchBlob } from '../api.js'
import { Icon, Modal } from './ui.jsx'

/** Mostra um PDF ou imagem privados e oferece o download, sem expor um link público. */
export function DocumentPane({ path, name }) {
  const [file, setFile] = useState(null) // { url, type }
  const [error, setError] = useState('')

  useEffect(() => {
    let url
    let cancelled = false
    fetchBlob(path)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setFile({ url, type: blob.type })
      })
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  return (
    <div className="document-pane">
      {error && <p className="error">{error}</p>}
      {!file && !error && <p className="muted">A carregar…</p>}
      {file?.type.startsWith('image/') && <img className="viewer-img" src={file.url} alt={name} />}
      {file?.type === 'application/pdf' && <iframe className="viewer-pdf" src={file.url} title={name} />}
      {file && (
        <div className="document-actions">
          <span className="muted small">{name}</span>
          <a className="button" href={file.url} download={name}>
            <Icon name="download" /> Descarregar
          </a>
        </div>
      )}
    </div>
  )
}

export default function Viewer({ path, name, onClose }) {
  return (
    <Modal title={name} onClose={onClose} wide>
      <DocumentPane path={path} name={name} />
    </Modal>
  )
}
