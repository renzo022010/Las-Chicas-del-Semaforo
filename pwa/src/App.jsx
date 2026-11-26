import { Route, Routes, NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { HealthContext, useApiHealth } from './health.js'
import { ProfileContext, readProfile, storeProfile } from './profile.js'
import Home from './pages/Home.jsx'
import Analyze from './pages/Analyze.jsx'
import Result from './pages/Result.jsx'
import History from './pages/History.jsx'

export default function App() {
  const health = useApiHealth()
  const [name, updateName] = useState(readProfile)
  const { pathname } = useLocation()
  const setName = (value) => updateName(storeProfile(value))
  return (
    <ProfileContext.Provider value={{ name, setName }}>
      <HealthContext.Provider value={health}>
        <header><div className="bar">
          <NavLink to="/" className="brand" aria-label="ÑawIA, inicio">
            <img src="/brand/crest.png" alt="Escudo de la UNALM" />
            <div><b>UNALM <span className="brand-app">ÑawIA</span></b><small>Universidad Nacional Agraria La Molina</small><small>Facultad de Agronomía</small></div>
          </NavLink>
          {(name || pathname !== '/') && <nav className="nav" aria-label="Navegación principal">
            <NavLink to="/" end>Inicio</NavLink><NavLink to="/analizar">Nueva placa</NavLink><NavLink to="/historial">Historial</NavLink>
          </nav>}
        </div></header>
        <main>
          {!name ? <Home /> : <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/analizar" element={<Analyze />} />
            <Route path="/resultado/:id" element={<Result />} />
            <Route path="/historial" element={<History />} />
            <Route path="*" element={<Home />} />
          </Routes>}
        </main>
        <footer>ÑawIA · Conteo de colonias con inteligencia artificial · UNALM</footer>
      </HealthContext.Provider>
    </ProfileContext.Provider>
  )
}
