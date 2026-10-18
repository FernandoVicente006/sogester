import { useEffect, useState } from 'react'
import { errorText, fetchBlob } from '../api.js'
import { Modal } from './ui.jsx'

/** Visualizador embutido de PDFs e imagens privados (sem descarregar para o disco). */
export default function Viewer({ path, name, onClose }) {
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
    <Modal title={name} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      {!file && !error && <p className="muted">A carregar…</p>}
      {file?.type.startsWith('image/') && <img className="viewer-img" src={file.url} alt={name} />}
      {file?.type === 'application/pdf' && <iframe className="viewer-pdf" src={file.url} title={name} />}
      {file && !file.type.startsWith('image/') && file.type !== 'application/pdf' && (
        <a href={file.url} download={name}>
          Descarregar {name}
        </a>
      )}
    </Modal>
  )
}
