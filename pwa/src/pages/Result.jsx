import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Icon } from '../icons.jsx'
import PlateReview, { pointsFromResult, pointsFromReview, reviewStats } from '../components/PlateReview.jsx'
import UfcCalculator from '../components/UfcCalculator.jsx'
import { updateRecent } from '../recent.js'

export default function Result() {
  const { id } = useParams()
  const [result, setResult] = useState(null)
  const [points, setPoints] = useState([])
  const [saved, setSaved] = useState(null) // revision guardada en la API
  const [ufc, setUfc] = useState(null) // calculo de UFC guardado junto a la foto
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setResult(null); setError(''); setEdited(false)
    Promise.all([api.result(id), api.savedReview(id), api.savedUfc(id)])
      .then(([r, review, savedUfc]) => {
        if (!alive) return
        setResult(r); setSaved(review); setUfc(savedUfc)
        setPoints(review ? pointsFromReview(review, r) : pointsFromResult(r))
      })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [id])

  async function persistReview() {
    const record = await api.review(id, points.map(({ x, y }) => ({ x, y })), 'Revisado en la PWA')
    setSaved(record); setEdited(false)
    updateRecent(id, { reviewed: record.reviewed_count })
    return record
  }

  async function saveReview() {
    setBusy(true); setError('')
    try { await persistReview() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  // El servidor calcula con el conteo guardado: si hay cambios sin guardar, primero se guarda la revision.
  async function saveUfc(body) {
    if (edited) await persistReview()
    const record = await api.saveUfc(id, body)
    setUfc(record)
    return record
  }

  if (error && !result) return <div className="stack"><p className="alert">{error}</p><Link className="btn btn-ghost" to="/analizar">Analizar otra foto</Link></div>
  if (!result) return <p className="muted">Cargando resultado…</p>

  const stats = reviewStats(points, result.count)
  const countLabel = edited ? 'con cambios sin guardar' : saved ? 'revisado' : 'automático'
  return <section>
    <div className="between title-row"><div className="pagehead"><p className="small muted">Análisis {id.slice(0, 8)}</p><h1>Resultado del análisis</h1></div>
      <div className="row"><Link className="secondary" to="/analizar"><Icon name="camera" />Nueva foto</Link><Link className="secondary" to="/historial"><Icon name="list" />Historial</Link></div>
    </div>
    <div className="columns result-columns">
      <article className="panel stack">
        <div className="between"><h2>Revisar placa</h2><strong className="count-total" aria-live="polite">{stats.total} colonias</strong></div>
        <PlateReview imageUrl={api.fileUrl(id, 'foto_original.jpg')} size={result.image_size} points={points} onChange={(p) => { setPoints(p); setEdited(true) }} />
        <div className="stats"><span>Automático: <b>{result.count}</b></span><span>Añadidas: <b>{stats.added}</b></span><span>Quitadas: <b>{stats.removed}</b></span></div>
        <p className="small muted">Motor IA · {result.processing_seconds} s · {stats.edge} cerca del borde</p>
        {saved && !edited && <p className="ok-note" role="status"><Icon name="check" size={18} />Revisión guardada: {saved.reviewed_count} colonias.</p>}
        {edited && <p className="warn small">Hay cambios sin guardar.</p>}
        {(result.warnings || []).slice(0, 2).map((w) => <p key={w} className="warn small">{w}</p>)}
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="row"><button className="primary" onClick={saveReview} disabled={busy || (!edited && saved)}>{busy ? 'Guardando…' : saved && !edited ? 'Revisión guardada' : 'Guardar revisión'}</button>
          <a className="link small" href={api.fileUrl(id, 'foto_conteo.jpg')} target="_blank" rel="noreferrer">Ver imagen anotada por el motor</a>
        </div>
      </article>
      <UfcCalculator key={id} count={stats.total} countLabel={countLabel} saved={ufc} onSave={saveUfc} />
    </div>
  </section>
}
