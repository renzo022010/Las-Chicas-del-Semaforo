import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useHealth } from '../health.js'
import { useProfile } from '../profile.js'
import { api } from '../api.js'
import { Icon } from '../icons.jsx'
import { HistoryRow } from './History.jsx'
import PetriMascot from '../components/PetriMascot.jsx'

export function EngineStatus() {
  const h = useHealth()
  if (h.status === 'checking') return <span className="pill">Conectando con la API…</span>
  if (h.status === 'offline') return <span className="pill pill-bad">Servidor apagado: inicia INICIAR.cmd</span>
  if (h.status === 'denied') return <span className="pill pill-bad">Sin acceso: abre el link o QR de INICIAR.cmd</span>
  const available = h.engines?.includes('hybrid')
  return <span className={'pill ' + (available ? 'pill-good' : 'pill-warn')} title={h.neural_error || ''}>{available ? `Motor IA · ${h.device}` : 'IA no disponible'}</span>
}

export default function Home() {
  const { name, setName } = useProfile()
  const [draft, setDraft] = useState('')
  const [recent, setRecent] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const camera = useRef(null), gallery = useRef(null)
  useEffect(() => {
    if (!name) return undefined
    let alive = true
    api.history().then((items) => alive && setRecent(items.slice(0, 3))).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [name])
  function pick(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (file) navigate('/analizar', { state: { file } })
  }
  if (!name) return <section id="ingreso" className="welcome">
    <div className="artbox"><h1>ÑawIA</h1><p className="art-subtitle">Una nueva mirada<br />a tus colonias.</p><PetriMascot /></div>
    <form className="formside" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) setName(draft) }}>
      <h2>¿Cómo te llamas?</h2><p className="muted">Escribe tu nombre para entrar al laboratorio.</p>
      <label className="field">Nombre de usuario<input placeholder="Ej. Valeria" maxLength={40} required autoComplete="nickname" value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
      <button className="primary" type="submit" disabled={!draft.trim()}>Entrar al laboratorio <Icon name="chevron" /></button>
      <p className="note">Tu nombre se guarda solo en este dispositivo.</p>
    </form>
  </section>
  return <section>
    <div className="panel greeting"><img className="avatar" src="/brand/avatar.png" alt="Petri con su lupa" /><div><h1>¡Hola, {name}!</h1><p>¿Qué placa vemos hoy?</p></div><button className="change-name" onClick={() => setName('')}>Cambiar nombre</button></div>
    <div className="columns">
      <article className="panel feature stack"><h2>Nuevo conteo</h2><p>Fotografía la placa completa o elige una imagen de tu galería.</p><div className="row">
        <button className="primary" onClick={() => camera.current.click()}><Icon name="camera" />Tomar foto</button>
        <button className="secondary" onClick={() => gallery.current.click()}><Icon name="image" />Galería</button>
      </div><EngineStatus /></article>
      <article className="panel stack"><div className="between"><h2>Últimos análisis</h2><Link className="link" to="/historial">Ver historial</Link></div>
        {error ? <p className="alert" role="alert">{error}</p> : recent === null ? <p className="muted">Cargando análisis…</p> : recent.length ? <ul className="history-list">{recent.map((item) => <li key={item.analysis_id}><HistoryRow item={item} /></li>)}</ul> : <p className="muted empty-history">Tu primera placa empieza aquí. Los análisis aparecerán en este espacio.</p>}
      </article>
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} aria-label="Tomar foto de una placa" />
    <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} aria-label="Elegir foto de galería" />
  </section>
}
