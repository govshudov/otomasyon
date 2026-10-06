/**
 * Arayüzün ortak Türkmence etiketleri.
 *
 * Sinyal ve ekipman adları buraya yazılmaz — onlar katalogdan
 * (`common/equipment_types.json`) ve istasyon konfigürasyonundan gelir.
 * Burada yalnız arayüzün kendi kelimeleri durur.
 */

/** Ekipman çalışma durumu → rozet metni */
export const STATE_TK: Record<string, string> = {
  RUNNING: 'IŞLEÝÄR',
  STOPPED: 'DURDY',
  STARTING: 'IŞE GIRÝÄR',
  STOPPING: 'DURÝAR',
  FAULT: 'NÄSAZ',
  MAINT: 'ABATLAÝYŞDA',
  UNKNOWN: 'MAGLUMAT ÝOK',
}

/** Rozet CSS sınıfı: durum + sağlık birlikte değerlendirilir (alarm baskın). */
export function stateClass(state: string, health?: string): string {
  if (health === 'ALARM' || state === 'FAULT') return 'alarm'
  if (health === 'WARN') return 'warn'
  return state.toLowerCase()
}

/** Sıra sayısı eki: 1-nji, 2-nji, 3-nji, 4-nji… (Türkmencede hep "-nji") */
export const ordinal = (n: number) => `${n}-nji`
