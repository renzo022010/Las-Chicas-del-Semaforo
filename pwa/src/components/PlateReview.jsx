import { useRef, useState } from 'react'
import { Icon } from '../icons.jsx'

// Puntos en pixeles de la foto original (mismo sistema que devuelve la API).
export function pointsFromResult(result) {
  return (result.detections || []).map((d) => ({ x: d.x, y: d.y, r: d.radius || 0, kind: d.near_edge ? 'edge' : 'auto' }))
}

// Las revisiones antiguas sin radios conservan la compatibilidad.
export function pointsFromReview(review, result) {
  const radii = (result.detections || []).map((d) => d.radius).filter(Boolean).sort((a, b) => a - b)
  const r = radii.length ? radii[Math.floor(radii.length / 2)] : 0
  return review.centers.map((c) => ({ x: c.x, y: c.y, r: c.r ?? r, kind: c.kind || 'auto' }))
}

export function reviewStats(points, automaticCount) {
  const added = points.filter((p) => p.kind === 'manual').length
  return {
    total: points.length,
    edge: points.filter((p) => p.kind === 'edge').length,
    added,
    removed: Math.max(0, automaticCount + added - points.length),
  }
}

export default function PlateReview({ imageUrl, size, points, onChange, disabled = false }) {
  const svgRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [history, setHistory] = useState([])
  const { width: W, height: H } = size
  const minR = Math.max(W, H) * 0.006
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(null)
  const gesture = useRef(null)
  const commit = (next) => { setHistory((h) => [...h.slice(-49), points]); onChange(next) }
  const position = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H }
  }
  function cancel() { gesture.current = null; setDraft(null) }
  function start(e) {
    if (disabled || !e.isPrimary || e.button !== 0 || gesture.current) return
    const p = position(e)
    gesture.current = { ...p, id: e.pointerId, clientX: e.clientX, clientY: e.clientY, moved: false, drawing: adding }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (adding) setDraft({ ...p, r: 0 })
  }
  function move(e) {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) > 3) g.moved = true
    if (g.drawing) {
      const p = position(e)
      setDraft({ x: g.x, y: g.y, r: Math.min(Math.hypot(p.x - g.x, p.y - g.y), Math.max(W, H)) })
    }
  }
  function finish(e) {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    cancel()
    if (disabled) return
    if (g.drawing) {
      const p = position(e)
      const radius = Math.min(Math.hypot(p.x - g.x, p.y - g.y), Math.max(W, H))
      if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) > 3 && radius > 0)
        commit([...points, { x: g.x, y: g.y, r: radius, kind: 'manual' }])
      return
    }
    if (g.moved) return
    let hit = -1, best = Infinity
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - g.x, p.y - g.y)
      if (d < Math.max(p.r * 1.3, minR * 2.5) && d < best) { best = d; hit = i }
    })
    if (hit >= 0) commit(points.filter((_, i) => i !== hit))
  }

  function undo() {
    if (!history.length) return
    onChange(history[history.length - 1])
    setHistory((h) => h.slice(0, -1))
  }

  const stroke = Math.max(W, H) * 0.0025
  return (
    <div className="review">
      <div className="review-tools">
        <span className="muted small">{adding ? 'Arrastra desde el centro para dibujar la colonia. Pulsa el botón otra vez para cancelar.' : 'Toca una marca para quitarla o activa Añadir colonia.'}</span>
        <div className="seg">
          <button type="button" aria-pressed={adding} disabled={disabled} onClick={() => { cancel(); setAdding(!adding) }}>Añadir colonia</button>
          {[1, 2, 3].map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} disabled={disabled} onClick={() => { cancel(); setZoom(z) }}>{z}×</button>
          ))}
          <button type="button" onClick={undo} disabled={disabled || !history.length} aria-label="Deshacer"><Icon name="undo" size={18} /></button>
        </div>
      </div>
      <div className="review-scroll">
        <div className="review-canvas" style={{ width: `${zoom * 100}%` }}>
          <img src={imageUrl} alt="Placa analizada" draggable="false" />
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} style={{ touchAction: adding ? 'none' : 'pan-x pan-y', cursor: adding ? 'crosshair' : 'default' }} role="img" aria-label={`${points.length} colonias marcadas`}>
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={p.r || minR} className={`dot dot-${p.kind}`} strokeWidth={stroke} />
            ))}
            {draft && <circle cx={draft.x} cy={draft.y} r={draft.r} className="dot dot-manual" strokeWidth={stroke} strokeDasharray={`${stroke * 3} ${stroke * 2}`} />}
          </svg>
        </div>
      </div>
      <div className="legend small">
        <span><i className="dot-key dot-auto" /> Detectada</span>
        <span><i className="dot-key dot-edge" /> Cerca del borde (revisar)</span>
        <span><i className="dot-key dot-manual" /> Añadida a mano</span>
      </div>
    </div>
  )
}
