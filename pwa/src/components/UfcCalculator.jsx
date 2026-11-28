import { useEffect, useState } from 'react'
import SampleFields, { validSample } from './SampleFields.jsx'
import { api } from '../api.js'
import { Icon } from '../icons.jsx'
import { fmtDateTime } from '../recent.js'
import { dilutionLabel, formulaText, ufcText } from '../ufc.js'

const EXPONENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const BLANK_SAMPLE = { code: '', sample_type: '', responsible: '', notes: '' }
const toNumber = (text) => Number(String(text).trim().replace(',', '.'))

// Formulario en texto (lo que se escribe) <-> cuerpo de la API (numeros).
export function formFromRecord(rec) {
  if (!rec) return { exponent: 1, volume: '0.1', unit: 'mL', min: '30', max: '300', sample: BLANK_SAMPLE }
  return {
    exponent: rec.exponent, volume: String(rec.volume_ml), unit: rec.unit,
    min: String(rec.count_min), max: String(rec.count_max), sample: { ...BLANK_SAMPLE, ...rec.sample },
  }
}

export function bodyFromForm(form) {
  return {
    exponent: Number(form.exponent), volume_ml: toNumber(form.volume), unit: form.unit,
    duplicate_count: null,
    count_min: toNumber(form.min), count_max: toNumber(form.max), sample: form.sample,
  }
}

export function formError(form) {
  const b = bodyFromForm(form)
  if (!(b.volume_ml > 0 && b.volume_ml <= 10)) return 'El volumen sembrado debe estar entre 0.01 y 10 mL.'
  if (!(Number.isInteger(b.count_min) && Number.isInteger(b.count_max) && b.count_min >= 0 && b.count_min < b.count_max)) return 'Revisa el rango contable: el mínimo debe ser menor que el máximo.'
  return ''
}

// Calculo de UFC de la placa analizada. `count` es el conteo que se ve en pantalla; al guardar, el servidor usa el
// conteo guardado (revision o automatico), por eso la pagina guarda primero la revision si hay cambios.
export default function UfcCalculator({ count, countLabel, saved, onSave, sample, onSampleChange, saving, reviewEdited }) {
  const [form, setForm] = useState(() => formFromRecord(saved))
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const invalid = formError(form)

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true) }


  // Vista previa con la misma formula del servidor (POST /ufc), sin guardar nada.
  useEffect(() => {
    if (invalid) { setPreview(null); return undefined }
    let alive = true
    const b = bodyFromForm(form)
    const t = setTimeout(() => {
      api.ufcPreview({
        dilutions: [{ exponent: b.exponent, volume_ml: b.volume_ml, plate_a: { count }, plate_b: { count: b.duplicate_count } }],
        unit: b.unit, count_min: b.count_min, count_max: b.count_max,
      }).then((r) => { if (alive) { setPreview(r); setError('') } })
        .catch((e) => alive && setError(e.message))
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [form, count, invalid])

  async function save() {
    setBusy(true); setError('')
    try { await onSave({ ...bodyFromForm(form), sample }); setDirty(false) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const row = preview?.rows?.[0]
  const stale = saved && !dirty && saved.count !== count
  const upToDate = saved && !dirty && !stale && !reviewEdited && saved.duplicate_count == null && ['code', 'sample_type', 'notes', 'responsible'].every(k => (saved.sample?.[k] || '') === sample[k])
  return (
    <section className="panel ufc-card stack" aria-labelledby="ufc-title">
      <div className="ufc-head">
        <span className="ufc-icon"><Icon name="calc" size={22} /></span>
        <div>
          <h3 id="ufc-title">Cálculo de UFC</h3>
          <p className="muted small">Conteo: <strong>{count}</strong> colonias ({countLabel})</p>
        </div>
      </div>

      <div className="ufc-form">
        <label className="field">
          <span className="label">Dilución de esta placa</span>
          <select className="input" value={form.exponent} onChange={(e) => set({ exponent: Number(e.target.value) })}>
            {EXPONENTS.map((e) => <option key={e} value={e}>{dilutionLabel(e)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Volumen sembrado (mL)</span>
          <input className="input" type="text" inputMode="decimal" value={form.volume} onChange={(e) => set({ volume: e.target.value })} />
          <span className="chips">
            <button type="button" aria-pressed={toNumber(form.volume) === 0.1} onClick={() => set({ volume: '0.1' })}>0.1 mL (100 µL)</button>
            <button type="button" aria-pressed={toNumber(form.volume) === 1} onClick={() => set({ volume: '1' })}>1 mL</button>
          </span>
        </label>
        <div className="field">
          <span className="label">Resultado por</span>
          <div className="seg" role="group" aria-label="Unidad del resultado">
            {['mL', 'g'].map((u) => <button key={u} type="button" aria-pressed={form.unit === u} onClick={() => set({ unit: u })}>UFC/{u}</button>)}
          </div>
        </div>
      </div>
      {form.unit === 'g' && <p className="muted small">Para UFC/g, la dilución debe incluir la del homogeneizado inicial (por ejemplo, 10 g en 90 mL = 10⁻¹).</p>}

      <details className="ufc-more">
        <summary>Rango contable</summary>
        <div className="ufc-form">
          <label className="field"><span className="label">Rango contable: mínimo</span>
            <input className="input" type="text" inputMode="numeric" value={form.min} onChange={(e) => set({ min: e.target.value.replace(/[^\d]/g, '') })} /></label>
          <label className="field"><span className="label">Rango contable: máximo</span>
            <input className="input" type="text" inputMode="numeric" value={form.max} onChange={(e) => set({ max: e.target.value.replace(/[^\d]/g, '') })} /></label>
        </div>
      </details>

      <div className="ufc-result" aria-live="polite">
        {invalid ? <p className="warn small">{invalid}</p> : !preview ? <p className="muted small">Calculando…</p> : (
          <>
            <span className="label">Resultado</span>
            <p className="ufc-value"><strong>{ufcText(preview)}</strong> <span>{preview.unit}</span></p>
            <p className="ufc-formula">{formulaText(row, form.unit)}</p>
            <p className="muted small">Fórmula: UFC/{form.unit} = colonias × factor de dilución ÷ volumen sembrado (mL)</p>
          </>
        )}
      </div>

      {upToDate && <p className="ok-note"><Icon name="check" size={18} /> Guardado en el historial · {fmtDateTime(saved.saved_at)}</p>}
      {stale && <p className="warn small">El conteo cambió desde el último cálculo guardado ({saved.count} colonias). Vuelve a guardar.</p>}
      {error && <p className="alert" role="alert">{error}</p>}

      <SampleFields sample={sample} onChange={onSampleChange} responsible={sample.responsible} disabled={busy || saving} />
      <button type="button" className="btn btn-primary btn-wide" disabled={busy || saving || !!invalid || !validSample(sample) || upToDate} onClick={save}>
        {busy ? 'Guardando…' : upToDate ? 'Cálculo guardado' : 'Guardar en el historial'}
      </button>
      <p className="muted small">Se guarda junto a la foto: conteo, dilución, volumen, resultado y datos de la muestra.</p>
    </section>
  )
}
