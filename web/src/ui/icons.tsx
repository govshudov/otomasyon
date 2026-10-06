/**
 * Arayüz simgeleri — satır içi SVG (JACE'in CSP'si dış yazı tipi/simge
 * kütüphanesine izin vermiyor; hepsi `currentColor` ile boyanır).
 */
import type { ReactNode } from 'react'

const S = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export const Icon = {
  menu: (p: { size?: number }) => <S {...p}><path d="M4 6h16M4 12h16M4 18h16" /></S>,
  map: (p: { size?: number }) => <S {...p}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></S>,
  cube: (p: { size?: number }) => <S {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></S>,
  overview: (p: { size?: number }) => <S {...p}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M7 13l3-3 3 2 4-4M8 21h8" /></S>,
  pumps: (p: { size?: number }) => <S {...p}><circle cx="9" cy="13" r="5" /><path d="M9 8V4h8v3M14 13h7M12.5 9.5l-3.5 3.5" /></S>,
  bell: (p: { size?: number }) => <S {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></S>,
  report: (p: { size?: number }) => <S {...p}><path d="M5 20V10M10 20V4M15 20v-7M20 20V8" /></S>,
  shield: (p: { size?: number }) => <S {...p}><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></S>,
  chart: (p: { size?: number }) => <S {...p}><path d="M3 3v18h18" /><path d="M6 15l4-5 3 3 6-7" /></S>,
  chevron: (p: { size?: number }) => <S {...p}><path d="M9 6l6 6-6 6" /></S>,
  user: (p: { size?: number }) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></S>,
  full: (p: { size?: number }) => <S {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></S>,
  close: (p: { size?: number }) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>,
  refresh: (p: { size?: number }) => <S {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></S>,
  save: (p: { size?: number }) => <S {...p}><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></S>,
  back: (p: { size?: number }) => <S {...p}><path d="M15 6l-6 6 6 6" /></S>,
  thermo: (p: { size?: number }) => <S {...p}><path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z" /><path d="M12 11v6" /></S>,
  cabinet: (p: { size?: number }) => <S {...p}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M8 7h8M8 11h8M12 15v3" /></S>,
  timer: (p: { size?: number }) => <S {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></S>,
  gauge: (p: { size?: number }) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 12l5-4" /><path d="M7 16h10" /></S>,
  bolt: (p: { size?: number }) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M13 6l-4 7h4l-2 5 5-7h-4z" /></S>,
  rotate: (p: { size?: number }) => <S {...p}><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" /><path d="M20 3v5h-5M20 12a8 8 0 0 1-13.7 5.7L4 16" /><path d="M4 21v-5h5" /></S>,
  warn: (p: { size?: number }) => <S {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></S>,
  drop: (p: { size?: number }) => <S {...p}><path d="M12 3c4 5 6.5 8.4 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 11.4 8 8 12 3z" /></S>,
  logout: (p: { size?: number }) => <S {...p}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></S>,
}

/** Marka: su damlası (önceki üst çubuktaki logo) */
export const Logo = ({ size = 30 }: { size?: number }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="logo">
    <circle cx="16" cy="16" r="15" fill="#fff" />
    <path d="M16 6c4 5.2 6.5 8.7 6.5 11.6A6.5 6.5 0 0 1 9.5 17.6C9.5 14.7 12 11.2 16 6z" fill="#1d6fd8" />
  </svg>
)
