import { useEffect, useRef } from 'react'
import svg from '../assets/petri.svg?raw'

export default function PetriMascot() {
  const ref = useRef(null)
  useEffect(() => {
    const root = ref.current
    const body = root.querySelector('#petri-cuerpo')
    const stars = [
      { node: root.querySelector('.estrella-arriba'), x: 54, y: 77, phase: Math.PI },
      { node: root.querySelector('.estrella-abajo'), x: 350, y: 286, phase: 0 },
    ]
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame, previous = null, elapsed = 0
    const tick = (now) => {
      if (previous !== null) elapsed += now - previous
      previous = now
      for (const star of stars) {
        const phase = elapsed * 2 * Math.PI / 9200 + star.phase
        const depth = Math.sin(phase), tilt = Math.PI / 8
        const u = 174 * Math.cos(phase), v = 148 * depth
        const x = 210 + u * Math.cos(tilt) - v * Math.sin(tilt)
        const y = 202 + u * Math.sin(tilt) + v * Math.cos(tilt)
        star.node.setAttribute('transform', `translate(${x} ${y}) scale(${.83 + .14 * depth}) translate(${-star.x} ${-star.y})`)
        const layer = depth < 0 ? 'back' : 'front'
        if (star.node.dataset.layer !== layer) {
          body.parentNode.insertBefore(star.node, depth < 0 ? body : null)
          star.node.dataset.layer = layer
        }
      }
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      cancelAnimationFrame(frame); previous = null
      if (!reduced.matches && !document.hidden) frame = requestAnimationFrame(tick)
      else stars.forEach((star) => star.node.removeAttribute('transform'))
    }
    sync(); reduced.addEventListener('change', sync); document.addEventListener('visibilitychange', sync)
    return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync) }
  }, [])
  // SVG fijo extraído del diseño entregado; no contiene texto ni HTML de usuarios.
  return <div className="mascot" ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />
}
