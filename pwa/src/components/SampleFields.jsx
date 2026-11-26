export const blankSample = { code: '', sample_type: '', notes: '' }
export const validSample = (sample) => !!(sample.code.trim() && sample.sample_type.trim())
export default function SampleFields({ sample, onChange, responsible, disabled = false }) {
  return <fieldset className="sample-fields stack" disabled={disabled}>
    <legend>Datos de la muestra</legend>
    <label className="field">Código de Muestra *<input required maxLength={40} value={sample.code} onChange={e => onChange({ ...sample, code: e.target.value })} /></label>
    <label className="field">Tipo de Muestra *<input required maxLength={40} value={sample.sample_type} onChange={e => onChange({ ...sample, sample_type: e.target.value })} /></label>
    <label className="field">Observaciones<textarea rows={2} maxLength={2000} value={sample.notes} onChange={e => onChange({ ...sample, notes: e.target.value })} /></label>
    <p className="small muted">Responsable: {responsible}. * Campos obligatorios.</p>
  </fieldset>
}
