import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useHealth } from '../health.js'
import { Icon } from '../icons.jsx'
import { saveRecent } from '../recent.js'

export default function Analyze() {
  const navigate = useNavigate()
  const location = useLocation()
  const health = useHealth()
  const [file, setFile] = useState(() => location.state?.file || null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const camera = useRef(null), gallery = useRef(null)
  const available = health.engines?.includes('hybrid')
  const online = health.status === 'ok'
  useEffect(() => {
    if (!file) { setPreview(''); return undefined }
    const url = URL.createObjectURL(file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  function pick(e) {
    const selected = e.target.files?.[0]; e.target.value = ''
    if (selected) { setError(''); setFile(selected) }
  }
  async function analyze() {
    setBusy(true); setError('')
    try {
      const r = await api.analyze(file, 'hybrid')
      saveRecent({ id: r.analysis_id, count: r.count, engine: r.engine, at: new Date().toISOString() })
      navigate(`/resultado/${r.analysis_id}`)
    } catch (e) { setError(e.message); setBusy(false) }
  }
  return <section>
    <div className="title-row pagehead"><h1>Registro fotográfico</h1><p className="muted">Incluye toda la placa en el encuadre.</p></div>
    <div className="panel stack">
      <div className="capture" aria-busy={busy}>
        {preview ? <img src={preview} alt="Vista previa de la placa seleccionada" /> : <div className="capture-empty"><Icon name="camera" size={40} /><p>Vista previa de tu foto</p><small>Usa buena iluminación y fotografía desde arriba.</small></div>}
        {busy && <div className="photo-busy" role="status"><span className="spinner" />Analizando la placa…</div>}
      </div>
      {file && <p className="small file-info" aria-live="polite">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
      <div className="between"><div className="row">
        <button className="secondary" disabled={busy} onClick={() => camera.current.click()}><Icon name="camera" />Capturar</button>
        <button className="secondary" disabled={busy} onClick={() => gallery.current.click()}><Icon name="image" />Galería</button>
      </div><button className="primary" disabled={!file || busy || !online || !available} onClick={analyze}>{busy ? 'Analizando…' : 'Analizar placa con IA'}<Icon name="chevron" /></button></div>
      {online && !available && <p className="alert" role="alert">El modelo IA no está disponible. Revisa el servidor antes de analizar.</p>}
      {health.status === 'offline' && <p className="alert">El servidor está apagado. Inícialo con INICIAR.cmd.</p>}
      {health.status === 'denied' && <p className="alert">Falta la clave de acceso. Abre el link completo o el QR de INICIAR.cmd.</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      <p className="note">En CPU el análisis puede tardar varios minutos. Mantén esta página abierta hasta obtener el resultado.</p>
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} aria-label="Capturar foto" />
    <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} aria-label="Elegir imagen" />
  </section>
}
