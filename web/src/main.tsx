import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { NasosSayfa } from './ui/NasosSayfa'
import { NasosEgriSayfa } from './ui/NasosEgri'
import './styles.css'

// nasos.html: eski TV Px sayfasındaki nasos popup'ının içi (3D sahne kurulmaz);
// nasos.html?egri: popup'tan açılan büyük H–Q çerçevesinin içi
const NASOS = /\/nasos\.html$/i.test(location.pathname)
const EGRI = NASOS && new URLSearchParams(location.search).has('egri')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {EGRI ? <NasosEgriSayfa /> : NASOS ? <NasosSayfa /> : <App />}
  </StrictMode>,
)
