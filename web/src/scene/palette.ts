/**
 * ISA-101 yüksek performanslı HMI paleti.
 *
 * Temel ilke: proses gri tonlarda kalır, renk YALNIZCA durum ve alarm için
 * ayrılır. Rengarenk bir ekran operatörde alarm körlüğü yaratır — bir şey
 * kırmızıysa gerçekten bakılması gerekir.
 */
export const PALETTE = {
  bg: 0x464d57,        // düz arka plan — referans görselden ölçüldü

  // Durum katmanı (geometrinin taban rengiyle karıştırılır). Koyu ve doygun:
  // açık tonlar beyaz motorla karışınca pastele dönüp birbirine benziyordu.
  // Işık köşe rengiyle ÇARPILDIĞI için yüksek güçte de parçanın şekli okunur.
  run: 0x0f7a35,        // çalışıyor — koyu yeşil (duran: renksiz/gri)
  warn: 0xb58900,       // bir şey iyi çalışmıyor (herhangi bir uyarı) — koyu sarı
  alarm: 0xa3161c,      // alarm / arıza — koyu kırmızı
  maint: 0x5d6068,      // bakımda — koyu gri
  unknown: 0x4a5058,    // veri yok
  select: 0x6fd0ff,     // seçili — açık camgöbeği
  hover: 0x9ee3ff,      // üzerinde — daha açık
} as const

/** Durum → (renk, güç). Güç 0 ise geometrinin kendi rengi görünür. */
export function stateOverlay(
  health: string | undefined,
  run: string | undefined,
): { color: number; strength: number } {
  if (health === 'ALARM') return { color: PALETTE.alarm, strength: 0.9 }
  if (run === 'FAULT') return { color: PALETTE.alarm, strength: 0.9 }
  if (health === 'WARN') return { color: PALETTE.warn, strength: 0.85 }
  if (health === 'UNKNOWN') return { color: PALETTE.unknown, strength: 0.45 }
  if (run === 'MAINT') return { color: PALETTE.maint, strength: 0.7 }
  if (run === 'RUNNING') return { color: PALETTE.run, strength: 0.85 }
  if (run === 'STARTING' || run === 'STOPPING') return { color: PALETTE.warn, strength: 0.4 }
  return { color: 0x000000, strength: 0 }
}
