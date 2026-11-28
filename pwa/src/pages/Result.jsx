import { Icon } from '../icons.jsx'
import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import PlateReview, { pointsFromResult, pointsFromReview, reviewStats } from '../components/PlateReview.jsx'
import UfcCalculator from '../components/UfcCalculator.jsx'
import { useProfile } from '../profile.js'
import { blankSample, validSample } from '../components/SampleFields.jsx'
import { updateRecent } from '../recent.js'

export default function Result() {
  const { id } = useParams()
  const { name } = useProfile()
  const [sample, setSample] = useState(blankSample)
  const changeSample = value => { setSample(value); setEdited(true) }
  const sampleBody = () => ({ ...sample, code: sample.code.trim(), sample_type: sample.sample_type.trim(), responsible: name })
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
    Promise.all([api.result(id), api.savedReview(id), api.savedUfc(id), api.savedSample(id)])
      .then(([r, review, savedUfc, storedSample]) => {
        if (!alive) return
        setResult(r); setSaved(review); setUfc(savedUfc)
        setSample({ ...blankSample, ...(storedSample || review?.sample || savedUfc?.sample) })
        setPoints(review ? pointsFromReview(review, r) : pointsFromResult(r))
      })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [id])

  async function persistReview() {
    if (!validSample(sample) || !name) throw new Error('Completa el código y el tipo de muestra e ingresa tu nombre.')
    const record = await api.review(id, points.map(({ x, y, r, kind }) => ({ x, y, r: r || undefined, kind })), sampleBody(), 'Revisado en la PWA')
    setSaved(record); setSample(record.sample); setEdited(false)
    updateRecent(id, { reviewed: record.reviewed_count })
    return record
  }

  // El servidor calcula con el conteo guardado: si hay cambios sin guardar, primero se guarda la revision.
  async function saveUfc(body) {
    setBusy(true)
    try {
      if (!validSample(sample) || !name) throw new Error('Completa el código y el tipo de muestra.')
      if (edited || !saved) await persistReview()
      const record = await api.saveUfc(id, { ...body, sample: sampleBody() })
      setUfc(record)
      return record
    } finally { setBusy(false) }
  }

  if (error && !result) return <div className="stack"><p className="alert">{error}</p><Link className="btn btn-ghost" to="/analizar">Analizar otra foto</Link></div>
  if (!result) return <p className="muted">Cargando resultado…</p>

  const stats = reviewStats(points, result.count)
  const countLabel = saved || edited ? 'revisado' : 'automático'
  return <section>
    <div className="between title-row"><div className="pagehead"><p className="small muted">Análisis {id.slice(0, 8)}</p><h1>Resultado del análisis</h1></div>
      <div className="row"><Link className="secondary" to="/analizar"><Icon name="camera" />Nueva foto</Link><Link className="secondary" to="/historial"><Icon name="list" />Historial</Link></div>
    </div>
    <div className="columns result-columns">
      <article className="panel stack">
        <div className="between"><h2>Revisar placa</h2><strong className="count-total" aria-live="polite">{stats.total} colonias</strong></div>
        <PlateReview disabled={busy} imageUrl={api.fileUrl(id, 'foto_original.jpg')} size={result.image_size} points={points} onChange={(p) => { setPoints(p); setEdited(true) }} />
        <div className="stats"><span>Automático: <b>{result.count}</b></span><span>Añadidas: <b>{stats.added}</b></span><span>Quitadas: <b>{stats.removed}</b></span></div>
        <div className="row">
          <a className="link small" href={api.fileUrl(id, 'foto_conteo.jpg')} target="_blank" rel="noreferrer">Ver imagen anotada por el motor</a>
        </div>
      </article>
      <UfcCalculator key={id} count={stats.total} countLabel={countLabel} saved={ufc} onSave={saveUfc} sample={{ ...sample, responsible: name }} onSampleChange={changeSample} saving={busy} reviewEdited={edited} />
    </div>
  </section>
}
