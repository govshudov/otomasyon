import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { NasosSayfa } from './ui/NasosSayfa'
import './styles.css'

// nasos.html: eski TV Px sayfasındaki nasos popup'ının içi (3D sahne kurulmaz)
const NASOS = /\/nasos\.html$/i.test(location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {NASOS ? <NasosSayfa /> : <App />}
  </StrictMode>,
)
