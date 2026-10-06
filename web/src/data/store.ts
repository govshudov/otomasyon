import { create } from 'zustand'
import type { TwinMap } from '../scene/types'
import { NIAGARA, NiagaraSource } from './niagara'
import { recordValues } from './history'

/**
 * Canlı veri deposu — API'nin WebSocket'ine bağlanır.
 *
 * Sözleşme docs/MQTT-CONTRACT.md'de. Frontend verinin simülatörden mi gerçek
 * PLC'den mi geldiğini BİLMEZ; devreye alma günü burada tek satır değişmez.
 */

export interface Sample { v: number | boolean | string; ts: number }

export interface Alarm {
  id: string; tag: string; equipment: string; component: string | null
  level: 'WARN' | 'ALARM'; msg: string
  state: 'NORM' | 'UNACK_ALM' | 'ACKED_ALM' | 'RTN_UNACK'
  value: number | boolean | null
  ts_raised: number; ts_acked: number; ts_cleared: number
}

export interface Playback {
  active: boolean
  playing: boolean
  ts: number          // epoch saniye — imlecin bulunduğu an
  speed: number       // 1 = gerçek zaman
  from: number
  to: number
  loading: boolean
}

interface TwinState {
  connected: boolean
  sourceAlive: boolean
  /** Veri bayat mı (Niagara heartbeat'i eski). Değerler gösterilir, arayüz uyarı verir. */
  dataStale: boolean
  /** Verinin zamanı (heartbeat zaman damgası, ms) — biliniyorsa */
  dataTs: number | null
  /** Gösterilen değerler. Oynatma açıkken geçmişten, kapalıyken canlıdan gelir. */
  values: Record<string, Sample>
  status: Record<string, { state: string; mode: string; ts: number }>
  /** Canlı akış her zaman güncel tutulur; oynatmadan çıkınca buna dönülür. */
  live: { values: Record<string, Sample>; status: Record<string, { state: string; mode: string; ts: number }> }
  playback: Playback
  health: Record<string, string>
  componentHealth: Record<string, string>
  alarms: Alarm[]
  /** Bu oturumda görülen alarm durum değişimleri (en yeni başta, en çok 300) */
  alarmLog: (Alarm & { ts: number })[]
  stale: Set<string>
  twinMap: TwinMap | null
  lastMessageAt: number
  /** Şu an bakılan istasyon. Sunucu yalnız bunun deltasını gönderir. */
  stationId: string
  /** Sunucuda geçmiş veri açık mı. Kapalıysa trend ve oynatma gizlenir. */
  historyEnabled: boolean
  /** Geçmiş demo için ÜRETİLMİŞ mi (ölçüm değil). Arayüz bunu etiketler. */
  historySeeded: boolean

  connect: (stationId?: string) => void
  disconnect: () => void
  switchStation: (stationId: string) => void
  enterPlayback: () => Promise<void>
  exitPlayback: () => void
  seek: (ts: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (n: number) => void
  ack: (id: string) => void
  ackAll: () => void
  injectFault: (body: Record<string, unknown>) => Promise<void>
  setTwinMap: (m: TwinMap) => void
}

let ws: WebSocket | null = null
let retry = 0
let retryTimer: number | undefined
let staleTimer: number | undefined

export const useTwin = create<TwinState>((set, get) => ({
  connected: false,
  sourceAlive: false,
  dataStale: false,
  dataTs: null,
  values: {},
  status: {},
  health: {},
  componentHealth: {},
  alarms: [],
  alarmLog: [],
  stale: new Set(),
  twinMap: null,
  lastMessageAt: 0,
  stationId: '',
  historyEnabled: false,
  historySeeded: false,
  live: { values: {}, status: {} },
  playback: { active: false, playing: false, ts: 0, speed: 1, from: 0, to: 0, loading: false },

  connect(stationId) {
    if (stationId) set({ stationId })
    if (ws && ws.readyState <= WebSocket.OPEN) return
    const sid = stationId ?? get().stationId
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    // JACE'te API yok: aynı mesajları BajaScript'ten üreten kaynak kullanılır
    ws = NIAGARA
      ? (new NiagaraSource(sid) as unknown as WebSocket)
      : new WebSocket(`${proto}//${location.host}/ws${sid ? `?station=${encodeURIComponent(sid)}` : ''}`)

    ws.onopen = () => {
      retry = 0
      set({ connected: true })
      // Geçmiş kapalıysa arayüz trend/oynatma düğmelerini hiç göstermemeli —
      // çalışmayan bir düğme sunmak, hata mesajı göstermekten daha kötü.
      if (NIAGARA) { set({ historyEnabled: false, historySeeded: false }); return }
      fetch('/api/health').then((r) => r.json())
        .then((h) => set({ historyEnabled: !!h.history, historySeeded: !!h.history_seeded }))
        .catch(() => set({ historyEnabled: false, historySeeded: false }))
    }

    ws.onclose = () => {
      set({ connected: false, sourceAlive: false })
      // Üstel geri çekilme — kopan bağlantı broker'ı boğmasın
      const delay = Math.min(1000 * 2 ** retry++, 15000)
      retryTimer = window.setTimeout(() => get().connect(), delay)
    }

    ws.onerror = () => ws?.close()

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      const now = Date.now()
      if (m.type === 'snapshot') {
        const live = { values: m.values ?? {}, status: m.status ?? {} }
        recordValues(live.values)
        set({
          live,
          ...(get().playback.active ? {} : { values: live.values, status: live.status }),
          health: m.health ?? {},
          componentHealth: m.component_health ?? {},
          alarms: m.alarms ?? [],
          sourceAlive: !!m.sources?.[m.station?.station_id ?? '']?.alive,
          dataStale: m.sources?.[m.station?.station_id ?? '']?.fresh === false,
          dataTs: m.sources?.[m.station?.station_id ?? '']?.data_ts ?? null,
          lastMessageAt: now,
        })
      } else if (m.type === 'delta') {
        if (m.values) recordValues(m.values)
        const s = get()
        const live = {
          values: m.values ? { ...s.live.values, ...m.values } : s.live.values,
          status: m.status ? { ...s.live.status, ...m.status } : s.live.status,
        }
        set({
          live,
          // Oynatma açıkken canlı akış ARKA PLANDA devam eder ama ekranı ezmez
          ...(s.playback.active ? {} : { values: live.values, status: live.status }),
          health: m.health ?? s.health,
          componentHealth: m.component_health ?? s.componentHealth,
          stale: m.stale ? new Set(m.stale) : s.stale,
          // Niagara kaynağı canlılığı (heartbeat) deltada da bildirir
          sourceAlive: m.sources ? !!m.sources[s.stationId]?.alive : s.sourceAlive,
          dataStale: m.sources ? m.sources[s.stationId]?.fresh === false : s.dataStale,
          dataTs: m.sources ? (m.sources[s.stationId]?.data_ts ?? null) : s.dataTs,
          lastMessageAt: now,
        })
      } else if (m.type === 'alarm') {
        const a: Alarm = m.alarm
        const list = get().alarms.filter((x) => x.id !== a.id)
        if (a.state !== 'NORM') list.push(a)
        list.sort((x, y) =>
          (x.level === 'ALARM' ? 0 : 1) - (y.level === 'ALARM' ? 0 : 1) || y.ts_raised - x.ts_raised)
        set({ alarms: list, alarmLog: [{ ...a, ts: now }, ...get().alarmLog].slice(0, 300) })
      }
    }

    // Kaynak sessizse "VERİ YOK" durumuna geç — son değeri canlıymış gibi gösterme
    clearInterval(staleTimer)
    staleTimer = window.setInterval(() => {
      const { lastMessageAt, sourceAlive } = get()
      if (sourceAlive && lastMessageAt && Date.now() - lastMessageAt > 12000) {
        set({ sourceAlive: false })
      }
    }, 3000)
  },

  /** İstasyon değiştir. Bağlantı kopmaz — sunucuya abonelik değişimi bildirilir. */
  switchStation(stationId) {
    if (get().stationId === stationId) return
    // Eski istasyonun verisi ekranda kalmasın; yenisi snapshot ile gelecek
    set({ stationId, values: {}, status: {}, health: {}, componentHealth: {},
          alarms: [], alarmLog: [], stale: new Set(), live: { values: {}, status: {} },
          playback: { ...get().playback, active: false, playing: false } })
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', station: stationId }))
    } else {
      get().connect(stationId)
    }
  },

  disconnect() {
    clearTimeout(retryTimer); clearInterval(staleTimer)
    ws?.close(); ws = null
  },

  ack(id) { ws?.send(JSON.stringify({ type: 'ack', alarm_id: id })) },
  ackAll() { ws?.send(JSON.stringify({ type: 'ack_all', station: get().stationId })) },

  async injectFault(body) {
    await fetch(`/api/dev/fault?station=${encodeURIComponent(get().stationId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  setTwinMap(m) { set({ twinMap: m }) },

  // ---- Geçmiş oynatma ------------------------------------------------ //

  async enterPlayback() {
    const r = await fetch('/api/history/range').then((x) => x.json())
    if (!r.from || !r.to) return
    set({ playback: { active: true, playing: false, ts: r.to, speed: 8, from: r.from, to: r.to, loading: false } })
    await fetchAt(set, get, r.to)
    startTicker(set, get)
  },

  exitPlayback() {
    stopTicker()
    const s = get()
    set({
      playback: { ...s.playback, active: false, playing: false },
      values: s.live.values, status: s.live.status,
    })
  },

  seek(ts) {
    const s = get()
    set({ playback: { ...s.playback, ts } })
    scheduleFetch(set, get, ts)
  },

  setPlaying(playing) {
    const s = get()
    set({ playback: { ...s.playback, playing } })
    if (playing) startTicker(set, get); else stopTicker()
  },

  setSpeed(speed) {
    const s = get()
    set({ playback: { ...s.playback, speed } })
  },
}))

// --------------------------------------------------------------------- //
// Oynatma zamanlayıcısı
// --------------------------------------------------------------------- //

type SetFn = (partial: Partial<TwinState>) => void
type GetFn = () => TwinState

let ticker: number | undefined
let fetchTimer: number | undefined
let inFlight = false

async function fetchAt(set: SetFn, get: GetFn, ts: number): Promise<void> {
  if (inFlight) return
  inFlight = true
  const p = get().playback
  set({ playback: { ...p, loading: true } })
  try {
    const sid = get().stationId
    const r = await fetch(`/api/history/at?ts=${Math.round(ts)}&station=${encodeURIComponent(sid)}`).then((x) => x.json())
    if (!get().playback.active) return
    set({ values: r.values ?? {}, status: r.status ?? {} })
  } catch {
    /* geçmiş alınamadı — mevcut kare korunur */
  } finally {
    inFlight = false
    const q = get().playback
    set({ playback: { ...q, loading: false } })
  }
}

/** Sürükleme sırasında her piksel için sorgu atmamak adına kısa gecikme. */
function scheduleFetch(set: SetFn, get: GetFn, ts: number): void {
  clearTimeout(fetchTimer)
  fetchTimer = window.setTimeout(() => fetchAt(set, get, ts), 120)
}

function startTicker(set: SetFn, get: GetFn): void {
  stopTicker()
  let last = performance.now()
  ticker = window.setInterval(() => {
    const s = get()
    if (!s.playback.active) return stopTicker()
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    if (!s.playback.playing) { fetchAt(set, get, s.playback.ts); return }
    let ts = s.playback.ts + dt * s.playback.speed
    if (ts >= s.playback.to) { ts = s.playback.to; set({ playback: { ...s.playback, ts, playing: false } }) }
    else set({ playback: { ...s.playback, ts } })
    fetchAt(set, get, ts)
  }, 500)
}

function stopTicker(): void {
  clearInterval(ticker); ticker = undefined
  clearTimeout(fetchTimer)
}

/** Tag değerini oku. Bayat ya da yoksa null döner — "veri yok" ayırt edilebilsin. */
export function readTag(values: Record<string, Sample>, stale: Set<string>, tag: string): number | boolean | string | null {
  if (stale.has(tag)) return null
  const s = values[tag]
  return s ? s.v : null
}

/**
 * Sayı biçimi: nokta ondalık, virgül binlik (1,133,050 · 2793.0) —
 * referans hasaplaýjy ekranlarıyla aynı.
 */
export function fmt(v: number | boolean | string | null, unit?: string | null, digits = 1): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'BAR' : 'ÝOK'
  if (typeof v === 'number') {
    const n = Number.isInteger(v) && Math.abs(v) < 1e6 && digits === 0 ? v.toString()
      : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    return unit ? `${n} ${unit}` : n
  }
  return String(v)
}
