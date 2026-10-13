/**
 * Niagara modu — sayfa JACE'in dosya alanından (`/file/twin/…`) açıldığında.
 *
 * O zaman ortada Python API'si yoktur. Veriler istasyondaki ikiz ağacından
 * BajaScript aboneliğiyle okunur:
 *
 *   station:|slot:/Twin/PS-01/PMP-01/flow_m3h          → PS-01.PMP-01.flow_m3h
 *   station:|slot:/Twin/PS-01/PMP-01/MOTOR/temp        → PS-01.PMP-01.MOTOR.temp
 *   station:|slot:/Twin/PS-01/PMP-01/state | mode      → ekipman durumu
 *   station:|slot:/Twin/PS-01/heartbeat                → kaynak canlı mı (15 sn içinde değişti mi)
 *
 * `NiagaraSource`, API'nin WebSocket'iyle AYNI mesajları üretir (snapshot /
 * delta / alarm). Böylece depo ve arayüz hangi kaynağa bağlı olduğunu bilmez.
 * Alarm motoru (ISA 18.2) tarayıcıda çalışır; kurallar twin-map'ten okunur.
 *
 * Grafikler: bir noktada history uzantısı (NumericInterval/Cov…) varsa geçmiş
 * Niagara'dan okunur — ad kuralı gerekmez, kimlik uzantının kendisinden
 * alınır. Yoksa sayfa açıldığından beri biriken değerler gösterilir
 * (`history.ts`). Oynatma (zaman çubuğu) bu modda kapalıdır.
 */
import type { SignalDef, TwinMap } from '../scene/types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Baja = any

/** Sayfa istasyonun içinden mi açıldı? `?source=niagara` ile zorlanabilir. */
export const NIAGARA = location.pathname.startsWith('/file/') ||
  new URLSearchParams(location.search).get('source') === 'niagara'

/** Uygulama dosyalarına göre adres (JACE'te /file/twin/…, geliştirmede /…). */
export const asset = (p: string) => new URL(p, document.baseURI).href

export interface StationEntry {
  id: string; name: string; description: string
  pumps: number; headers: number; cells: number; equipment: number
  model: string; twin_map: string; config?: string; model_parts?: string[]
  source_alive: boolean; alarms: number
}
/** `niagara_station`: paketin kurulduğu Niagara istasyonunun adı (ayar → niagara.istasyon) */
interface StationsDoc { stations: StationEntry[]; default?: string; niagara_root?: string; niagara_station?: string }

let stationsP: Promise<StationsDoc> | null = null

/** İstasyon listesi: API'den ya da (Niagara'da) uygulamayla gelen stations.json'dan. */
export function fetchStations(): Promise<StationsDoc> {
  if (!NIAGARA) return fetch('/api/stations').then((r) => r.json())
  stationsP ??= fetch(asset(`stations.json?v=${__BUILD_ID__}`)).then((r) => r.json())
  stationsP.catch(() => { stationsP = null })
  return stationsP
}

/** İstasyon konfigürasyonu (pompa → kolektör üyeliği 2D şema için). */
export async function fetchStationConfig(sid: string): Promise<any> {
  if (!NIAGARA) return fetch(`/api/station/${encodeURIComponent(sid)}`).then((r) => r.json())
  const e = (await fetchStations()).stations.find((s) => s.id === sid)
  if (!e?.config) throw new Error(`beket konfigurasiýasy ýok: ${sid}`)
  return fetch(asset(`${e.config}?v=${__BUILD_ID__}`)).then((r) => r.json())
}

// --------------------------------------------------------------------------- //
// BajaScript
// --------------------------------------------------------------------------- //

let bajaP: Promise<Baja> | null = null

function addScript(src: string): Promise<void> {
  return new Promise((ok, fail) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => ok()
    s.onerror = () => fail(new Error(`BajaScript ýüklenmedi (${src}). Sahypa JACE-den we içeri girip açyldymy?`))
    document.head.appendChild(s)
  })
}

/**
 * Yazma çağrıları CSRF jetonu ister; istasyonun kendi sayfaları onu bir gizli
 * alana koyar. Bizim sayfamız istasyonun ürettiği bir sayfa olmadığı için
 * jeton bir istasyon sayfasından okunup aynı biçimde eklenir.
 */
async function ensureCsrf(): Promise<void> {
  if (document.getElementById('csrfToken')) return
  const html = await (await fetch('/ord?station:%7Cslot:/', { credentials: 'same-origin' })).text()
  const m = /id=['"]csrfToken['"][^>]*value=['"]([^'"]+)['"]/.exec(html)
  if (!m) return
  const i = document.createElement('input')
  i.type = 'hidden'; i.id = 'csrfToken'; i.value = m[1]
  document.body.appendChild(i)
}

export function loadBaja(): Promise<Baja> {
  bajaP ??= (async () => {
    await ensureCsrf().catch(() => {})
    const w = window as any
    if (typeof w.require !== 'function') {
      await addScript('/requirejs/config.js')
      await addScript('/module/js/com/tridium/js/ext/require/require.min.js')
    }
    return new Promise<Baja>((ok, fail) => {
      const t = setTimeout(() => fail(new Error('BajaScript başlamady (wagt gutardy)')), 60_000)
      w.require(['baja!'], (b: Baja) => { clearTimeout(t); ok(b) },
        (e: unknown) => { clearTimeout(t); fail(e instanceof Error ? e : new Error(String(e))) })
    })
  })()
  bajaP.catch(() => { bajaP = null })
  return bajaP
}

// --------------------------------------------------------------------------- //
// Geçmiş ve oturum bilgisi
// --------------------------------------------------------------------------- //

/** tag → Niagara geçmiş kimliği ("/PSS21_…/PMP01_t1"); uzantı kimliği taşıyorsa doldurulur */
const historyIds = new Map<string, string>()
/** tag → geçmiş adı = veritabanındaki ad ("TWIN_PMP03_t1"); TsOkuma servisine bu ad gönderilir */
const historyNames = new Map<string, string>()

export const hasNiagaraHistory = (tag: string) => historyIds.has(tag)

// Grafikler ilk sorgudan önce adların eşlenmesini bekler (abonelik birkaç yüz ms sürer)
let namesReady: () => void = () => {}
const namesReadyP = new Promise<void>((ok) => { namesReady = ok })
export const historyNamesReady = (ms = 20_000) =>
  Promise.race([namesReadyP, new Promise<void>((ok) => setTimeout(ok, ms))])

/** Noktanın history uzantısı (yoksa null). Alt bileşen olduğu için değerleri ancak abone olunca gelir. */
function historyExtOf(comp: any): any | null {
  let ext: any = null
  try {
    comp.getSlots().properties().each((slot: any) => {
      const v = comp.get(slot)
      const t = v?.getType?.()
      if (!ext && t && t.isComponent() && t.is('history:HistoryExt')) ext = v
    })
  } catch { /* uzantı okunamadı — oturum tamponu kullanılır */ }
  return ext
}

const encoded = (v: any) => (v ? (typeof v.encodeToString === 'function' ? v.encodeToString() : String(v)) : '')

/** Abone olunmuş uzantının kayıtlı geçmiş kimliği (çoğu uzantıda boş gelir → null). */
function historyIdOf(ext: any): string | null {
  try {
    const s = encoded(ext.get('historyConfig')?.get?.('id'))
    return s && s !== '/' && !s.endsWith('/') ? s : null
  } catch { return null }
}

/**
 * Abone olunmuş uzantının geçmiş adı: historyName biçimi çözülür
 * ("TWIN_PMP03_t1" ya da "%parent.parent.name%_%parent.name%" → "BA4_G9_Toplam").
 * Sürücü veritabanına bu adla yazar. Uzantı kapalıysa ya da biçim çözülemezse null.
 */
function historyNameOf(ext: any): string | null {
  try {
    if (ext.get('enabled') === false) return null
    const id = historyIdOf(ext)
    if (id) return id.split('/').pop() || null
    const f = encoded(ext.get('historyName'))
    if (!f) return null
    let bad = false
    const name = f.replace(/%((?:parent\.)*)name%/g, (_m: string, ups: string) => {
      let c = ext
      for (let k = ups.length / 'parent.'.length; k > 0 && c; k--) c = c.getParent?.()
      const n = c?.getName?.()
      if (!n) bad = true
      return n ?? ''
    })
    return bad || name.includes('%') ? null : name
  } catch { return null }
}

/** Noktanın veritabanındaki adı (geçmiş adı); history uzantısı yoksa null. */
export const dbNameOf = (tag: string) => historyNames.get(tag) ?? null

let tsComp: Promise<any> | null = null

/**
 * TimescaleDB okuma servisi: istasyondaki /TsOkuma Program'ının "sorgu" eylemi
 * (tools/jace/okuma). Servis kurulu değilse null; sorgu hatası fırlatılır.
 */
export async function tsQuery(req: string): Promise<any | null> {
  tsComp ??= loadBaja().then((baja) => baja.Ord.make('station:|slot:/TsOkuma').get()).catch(() => null)
  const comp = await tsComp
  if (!comp) return null
  const j = JSON.parse(String(await comp.invoke({ slot: 'sorgu', value: req })))
  if (j?.error) throw new Error(j.error)
  return j
}

/** [epoch_sn, değer] kayıtları; geçmiş yoksa null. */
export async function niagaraHistory(tag: string, fromS: number, toS: number, limit = 20_000): Promise<[number, number][] | null> {
  const id = historyIds.get(tag)
  if (!id) return null
  const baja = await loadBaja()
  const at = (s: number) => baja.AbsTime.make({ jsDate: new Date(s * 1000) }).encodeToString()
  const base = `history:${id}?start=${at(fromS)};end=${at(toS)}`
  const read = async (ord: string) => {
    const out: [number, number][] = []
    await baja.Ord.make(ord).get({
      cursor: {
        limit,
        each: function (this: any, row: any) {
          const r = this && typeof this.get === 'function' ? this : row
          const ts = r.get('timestamp'), v = r.get('value')
          const ms = typeof ts?.getJsDate === 'function' ? ts.getJsDate().getTime() : NaN
          const x = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v?.valueOf?.() ?? v)
          if (Number.isFinite(ms) && Number.isFinite(x)) out.push([ms / 1000, x])
        },
      },
    })
    return out
  }
  try { return await read(`${base}|bql:select timestamp, value`) } catch { return await read(base) }
}

/** Oturumdaki Niagara kullanıcısı (başlıkta gösterilir). */
export async function niagaraUser(): Promise<string | null> {
  if (!NIAGARA) return null
  try { const b = await loadBaja(); return String(b.getUserName?.() ?? '') || null } catch { return null }
}

/**
 * Paket bu istasyonun mu? İstasyon klasörü başka PC'ye kopyalanırken eski ya da başka
 * istasyonun arayüzü (`file:^twin`) gelebilir; o zaman nasoslar uymaz. İstasyonun kendi adı
 * (`stationName`) paketteki `niagara_station` ile, `/Twin/<sid>` klasörünün varlığıyla
 * denetlenir. Sorun yoksa (ya da okunamazsa) null.
 */
export async function stationMismatch(sid: string): Promise<string | null> {
  if (!NIAGARA) return null
  try {
    const [doc, baja] = await Promise.all([fetchStations(), loadBaja()])
    const want = doc.niagara_station
    if (want) {
      const root = await baja.Ord.make('station:|slot:/').get().catch(() => null)
      const have = root ? String(root.get('stationName') ?? '') : ''
      if (have && have !== want) {
        return `Bu interfeýs ${want} beketi üçin, bu Niagara beketi ${have}: nasoslar gabat gelmeýär. Dogry paketi gurnaň (make kur ADIM=8).`
      }
    }
    const tw = await baja.Ord.make(`station:|${doc.niagara_root ?? 'slot:/Twin'}/${sid}`).get().then(() => true, () => false)
    if (!tw) return `Niagara-da /Twin/${sid} ýok: bu beketde ${sid} gurnalmandyr (make kur ADIM=8 BITIR=9).`
  } catch { /* BajaScript yok: denetlenemez */ }
  return null
}

/** Bir noktanın `out` değeri: JS değeri + geçerli mi. */
function readOut(sv: any): { v: number | boolean | string | null; ok: boolean } {
  try {
    if (!sv) return { v: null, ok: false }
    let v = sv.getValue()
    if (v instanceof Number || v instanceof Boolean || v instanceof String) v = v.valueOf()
    else if (v !== null && typeof v === 'object') v = typeof v.getTag === 'function' ? v.getTag() : String(v)
    if (typeof v === 'number' && Number.isNaN(v)) return { v: null, ok: false }
    const st = sv.getStatus()
    const ok = st ? (typeof st.isValid === 'function' ? st.isValid()
      : !(st.isFault?.() || st.isDown?.() || st.isStale?.() || st.isDisabled?.() || st.isNull?.())) : true
    return { v, ok }
  } catch {
    return { v: null, ok: false }
  }
}

// --------------------------------------------------------------------------- //
// Alarm motoru — api/alarms.py'nin tarayıcı karşılığı (ISA 18.2)
// --------------------------------------------------------------------------- //

const HYST_FRAC = 0.02
const ON_DELAY_MS = 3000

interface Rule {
  tag: string; equipment: string; component: string | null
  level: 'WARN' | 'ALARM'; op: string; value: number | boolean; msg: string; hyst: number
}
interface AlarmRec {
  id: string; tag: string; station: string; equipment: string; component: string | null
  level: 'WARN' | 'ALARM'; msg: string; state: string; value: number | boolean | null
  ts_raised: number; ts_acked: number; ts_cleared: number
}

class AlarmEngine {
  private rules: Rule[] = []
  private byKey = new Map<string, AlarmRec>()
  private pending = new Map<string, number>()
  private seq = 0

  constructor(private sid: string, tm: TwinMap) {
    for (const [eqId, eq] of Object.entries(tm.equipment)) {
      const add = (comp: string | null, sig: SignalDef) => {
        const r = sig.range
        const hyst = r ? Math.abs(r[1] - r[0]) * HYST_FRAC : 0
        for (const a of sig.alarms ?? []) {
          this.rules.push({ tag: sig.tag, equipment: eqId, component: comp, level: a.level, op: a.op,
                            value: a.value, msg: `${eq.label} — ${a.msg}`,
                            hyst: typeof a.value === 'boolean' ? 0 : hyst })
        }
      }
      for (const s of Object.values(eq.signals)) add(null, s)
      for (const [ck, c] of Object.entries(eq.components)) for (const s of Object.values(c.signals)) add(ck, s)
    }
  }

  private cond(r: Rule, v: unknown, active: boolean): boolean {
    if (typeof r.value === 'boolean' || r.op === '==' || r.op === '!=') return r.op === '!=' ? v !== r.value : v === r.value
    if (typeof v !== 'number') return false
    let thr = r.value as number
    if (active) thr = r.op.startsWith('>') ? thr - r.hyst : thr + r.hyst
    return r.op === '>' ? v > thr : r.op === '>=' ? v >= thr : r.op === '<' ? v < thr : r.op === '<=' ? v <= thr : false
  }

  /** Dönen: durumu değişen alarmlar. */
  evaluate(values: Record<string, { v: unknown }>, stale: Set<string>, dtMs: number): AlarmRec[] {
    const now = Date.now()
    const changed: AlarmRec[] = []
    for (const r of this.rules) {
      const key = `${r.tag}|${r.level}`
      let a = this.byKey.get(key)
      const active = !!a && (a.state === 'UNACK_ALM' || a.state === 'ACKED_ALM')
      const s = values[r.tag]
      if (!s || stale.has(r.tag)) continue            // veri yok: alarm ne doğar ne düşer
      const c = this.cond(r, s.v, active)
      if (c && !active) {
        const t = (this.pending.get(key) ?? 0) + dtMs
        this.pending.set(key, t)
        if (t < ON_DELAY_MS) continue
      } else this.pending.delete(key)
      if (!a) {
        if (!c) continue
        a = { id: `n${++this.seq}`, tag: r.tag, station: this.sid, equipment: r.equipment, component: r.component,
              level: r.level, msg: r.msg, state: 'NORM', value: null, ts_raised: 0, ts_acked: 0, ts_cleared: 0 }
        this.byKey.set(key, a)
      }
      const prev = a.state
      a.value = s.v as number | boolean
      if (c && (a.state === 'NORM' || a.state === 'RTN_UNACK')) { a.state = 'UNACK_ALM'; a.ts_raised = now; a.ts_cleared = 0 }
      else if (!c && a.state === 'UNACK_ALM') { a.state = 'RTN_UNACK'; a.ts_cleared = now }
      else if (!c && a.state === 'ACKED_ALM') { a.state = 'NORM'; a.ts_cleared = now }
      if (a.state !== prev) changed.push({ ...a })
    }
    return changed
  }

  ack(id: string): AlarmRec | null {
    for (const a of this.byKey.values()) {
      if (a.id !== id) continue
      if (a.state === 'UNACK_ALM') a.state = 'ACKED_ALM'
      else if (a.state === 'RTN_UNACK') a.state = 'NORM'
      else return null
      a.ts_acked = Date.now()
      return { ...a }
    }
    return null
  }

  ackAll(): AlarmRec[] {
    return [...this.byKey.values()].filter((a) => a.state === 'UNACK_ALM' || a.state === 'RTN_UNACK')
      .map((a) => this.ack(a.id)).filter((x): x is AlarmRec => !!x)
  }

  active(): AlarmRec[] {
    const sev: Record<string, number> = { ALARM: 0, WARN: 1 }
    const ord: Record<string, number> = { UNACK_ALM: 0, ACKED_ALM: 1, RTN_UNACK: 2 }
    return [...this.byKey.values()].filter((a) => a.state !== 'NORM')
      .sort((x, y) => sev[x.level] - sev[y.level] || ord[x.state] - ord[y.state] || y.ts_raised - x.ts_raised)
      .map((a) => ({ ...a }))
  }

  health(): { health: Record<string, string>; component_health: Record<string, string> } {
    const h: Record<string, string> = {}, ch: Record<string, string> = {}
    const put = (m: Record<string, string>, k: string, lvl: string) => { if (lvl === 'ALARM' || !m[k]) m[k] = lvl }
    for (const a of this.byKey.values()) {
      if (a.state !== 'UNACK_ALM' && a.state !== 'ACKED_ALM') continue
      put(h, `${a.station}.${a.equipment}`, a.level)
      if (a.component) put(ch, `${a.station}.${a.equipment}/${a.component}`, a.level)
    }
    return { health: h, component_health: ch }
  }
}

// --------------------------------------------------------------------------- //
// Kaynak: WebSocket gibi davranır, mesajları BajaScript'ten üretir
// --------------------------------------------------------------------------- //

const HB_TIMEOUT_MS = 15_000
const FLUSH_MS = 200

interface PointRef { comp: any; kind: 'value' | 'status' | 'heartbeat'; key: string; eq?: string }

export class NiagaraSource {
  readyState = 0                       // WebSocket sabitleriyle aynı: 0 bağlanıyor, 1 açık, 3 kapalı
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null

  private baja: Baja = null
  private sub: any = null
  private gen = 0
  private sid = ''
  private refs = new Map<string, PointRef>()
  private values: Record<string, { v: unknown; ts: number }> = {}
  private status: Record<string, { state: string; mode: string; ts: number }> = {}
  private stale = new Set<string>()
  private dirtyV = new Set<string>()
  private dirtyS = new Set<string>()
  private engine: AlarmEngine | null = null
  private hasHb = false
  private hbAt = 0
  private hbVal: number | null = null
  private wasFresh = false
  private timers: number[] = []
  private closed = false

  constructor(sid: string) {
    this.start(sid).catch((e) => this.fail(e))
  }

  private async start(sid: string): Promise<void> {
    this.baja = await loadBaja()
    if (this.closed) return
    this.readyState = 1
    this.onopen?.()
    await this.load(sid)
    this.timers.push(window.setInterval(() => this.flush(), FLUSH_MS))
    this.timers.push(window.setInterval(() => this.tickAlarms(500), 500))
  }

  private fail(e: unknown): void {
    console.error('[niagara]', e)
    if (this.closed) return
    this.close()
  }

  send(raw: string): void {
    const m = JSON.parse(raw)
    if (m.type === 'subscribe' && m.station) this.load(m.station).catch((e) => this.fail(e))
    else if (m.type === 'ack' && this.engine) {
      const a = this.engine.ack(m.alarm_id)
      if (a) this.emit({ type: 'alarm', alarm: a })
    } else if (m.type === 'ack_all' && this.engine) {
      for (const a of this.engine.ackAll()) this.emit({ type: 'alarm', alarm: a })
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.timers.forEach(clearInterval)
    this.timers = []
    this.dropSub()
    this.onclose?.()
  }

  private emit(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }

  private dropSub(): void {
    try { this.sub?.unsubscribeAll?.(); this.sub?.detach?.() } catch { /* bağlantı zaten gitmiş olabilir */ }
    this.sub = null
  }

  /**
   * Veri TAZE mi? Heartbeat son 15 sn'de değiştiyse ya da değeri bir zaman
   * damgasıysa ve şimdiye yakınsa taze. Bayat veri yine de GÖSTERİLİR (pompa
   * renkleri, değerler) — arayüz yalnız "KÖNE MAGLUMAT · tarih" uyarısı verir.
   * Bağlantı (alive) ayrı: BajaScript bağlıysa kaynak canlıdır; tek tek
   * noktaların geçerliliği zaten kendi durum bayraklarından okunuyor.
   */
  private fresh(): boolean {
    if (!this.hasHb) return true
    if (Date.now() - this.hbAt < HB_TIMEOUT_MS) return true
    const t = this.hbTime()
    return t !== null && Math.abs(Date.now() - t) < 5 * 60_000
  }

  /** Heartbeat değeri epoch (sn ya da ms) ise o an — "veri ne zamandan" bilgisi. */
  private hbTime(): number | null {
    const v = this.hbVal
    if (v === null || !Number.isFinite(v)) return null
    if (v > 1e12 && v < 1e14) return v                  // ms
    if (v > 1e9 && v < 1e11) return v * 1000            // sn
    return null
  }

  private source(): object {
    return { [this.sid]: { alive: true, fresh: this.fresh(), data_ts: this.hbTime(), source: 'niagara' } }
  }

  /** İstasyonun ikiz ağacını tarar, noktalara abone olur, ilk görüntüyü gönderir. */
  private async load(sid: string): Promise<void> {
    const gen = ++this.gen
    const baja = this.baja
    this.sid = sid
    this.values = {}; this.status = {}; this.stale = new Set(); this.refs.clear()
    this.dirtyV.clear(); this.dirtyS.clear()
    this.hasHb = false; this.hbAt = 0; this.hbVal = null; this.engine = null
    this.dropSub()

    const doc = await fetchStations()
    const entry = doc.stations.find((s) => s.id === sid)
    const root = doc.niagara_root ?? 'slot:/Twin'
    if (entry) {
      try {
        const tm: TwinMap = await fetch(asset(`${entry.twin_map}?v=${__BUILD_ID__}`)).then((r) => r.json())
        if (gen === this.gen) this.engine = new AlarmEngine(sid, tm)
      } catch { /* alarm motoru olmadan da değerler gösterilir */ }
    }

    const sub = new baja.Subscriber()
    const self = this
    sub.attach('changed', function (this: any, prop: any) {
      if (gen !== self.gen || prop.getName() !== 'out') return
      const ref = self.refs.get(String(this.getHandle()))
      if (ref) self.apply(ref, false)
    })
    this.sub = sub

    const points = await this.scan(`station:|${root}/${baja.SlotPath.escape(sid)}`)
    if (gen !== this.gen || this.closed) return
    if (points.length) await sub.subscribe({ comps: points.map((p) => p.comp) })
    if (gen !== this.gen || this.closed) return
    for (const p of points) { this.refs.set(String(p.comp.getHandle()), p); this.apply(p, true) }
    this.dirtyV.clear(); this.dirtyS.clear()
    // History uzantıları alt bileşen: değerleri (historyName, enabled) ancak abone olunca gelir.
    // Tek seferlik toplu abonelik, okunduktan sonra bırakılır (değerler bileşende kalır).
    historyIds.clear(); historyNames.clear()
    const withExt = points.filter((p) => p.kind === 'value').map((p) => ({ p, ext: historyExtOf(p.comp) })).filter((x) => x.ext)
    if (withExt.length) {
      const hs = new baja.Subscriber()
      try {
        await hs.subscribe({ comps: withExt.map((x) => x.ext) })
        for (const { p, ext } of withExt) {
          const id = historyIdOf(ext), name = historyNameOf(ext)
          if (id) historyIds.set(p.key, id)
          if (name) historyNames.set(p.key, name)
        }
        hs.unsubscribe({ comps: withExt.map((x) => x.ext) }).catch(() => {})
      } catch (e) { console.warn('[niagara] history uzantıları okunamadı', e) }
    }
    namesReady()
    if (gen !== this.gen || this.closed) return
    console.info(`[niagara] ${historyNames.size}/${withExt.length} nokta geçmiş adıyla eşlendi`)
    if (!points.length) console.warn(`[niagara] nokta tapylmady: station:|${root}/${sid}`)

    this.wasFresh = this.fresh()
    this.emit({
      type: 'snapshot', station: { station_id: sid },
      values: this.values, status: this.status,
      alarms: this.engine?.active() ?? [], ...(this.engine?.health() ?? { health: {}, component_health: {} }),
      sources: this.source(),
    })
  }

  /** Ağacı en fazla 4 seviye gezer; her kontrol noktasını yoluna göre sınıflar. */
  private async scan(ord: string): Promise<PointRef[]> {
    const baja = this.baja
    let rootComp: any
    try { rootComp = await baja.Ord.make(ord).get() } catch { return [] }
    const out: PointRef[] = []
    let level: { comp: any; path: string[] }[] = [{ comp: rootComp, path: [] }]
    for (let depth = 0; level.length && depth < 4; depth++) {
      await Promise.all(level.map((x) => Promise.resolve(x.comp.loadSlots?.()).catch(() => {})))
      const next: { comp: any; path: string[] }[] = []
      for (const { comp, path } of level) {
        comp.getSlots().properties().each((slot: any) => {
          const v = comp.get(slot)
          const t = v?.getType?.()
          if (!t || !t.isComponent()) return
          const p = [...path, baja.SlotPath.unescape(String(slot.getName()))]
          if (t.is('control:ControlPoint')) {
            const ref = this.classify(p, v)
            if (ref) out.push(ref)
          } else next.push({ comp: v, path: p })
        })
      }
      level = next
    }
    return out
  }

  private classify(p: string[], comp: any): PointRef | null {
    if (p.length === 1 && p[0] === 'heartbeat') { this.hasHb = true; return { comp, kind: 'heartbeat', key: '' } }
    if (p.length === 1) return null                                   // cmd_fault vb.
    if (p.length === 2 && (p[1] === 'state' || p[1] === 'mode')) return { comp, kind: 'status', key: p[1], eq: p[0] }
    return { comp, kind: 'value', key: `${this.sid}.${p.join('.')}` }
  }

  private apply(ref: PointRef, initial: boolean): void {
    const { v, ok } = readOut(ref.comp.get('out'))
    const now = Date.now()
    if (ref.kind === 'heartbeat') {
      this.hbVal = typeof v === 'number' ? v : null
      if (!initial) this.hbAt = now
      return
    }
    if (ref.kind === 'status') {
      const k = `${this.sid}.${ref.eq}`
      const cur = this.status[k] ?? { state: 'UNKNOWN', mode: 'AUTO', ts: now }
      const s = typeof v === 'string' && v ? v : ref.key === 'state' ? 'UNKNOWN' : 'AUTO'
      this.status[k] = { ...cur, [ref.key]: s, ts: now }
      this.dirtyS.add(k)
      return
    }
    if (ok && v !== null) { this.values[ref.key] = { v, ts: now }; this.stale.delete(ref.key) }
    else this.stale.add(ref.key)
    this.dirtyV.add(ref.key)
  }

  private lastEmit = 0

  private flush(): void {
    if (this.closed || this.readyState !== 1) return
    const fresh = this.fresh()
    const freshChanged = fresh !== this.wasFresh
    this.wasFresh = fresh
    // Değer değişmese de 5 sn'de bir haber ver: depo 12 sn sessizliği "veri yok" sayıyor
    const quiet = Date.now() - this.lastEmit > 5000
    if (!this.dirtyV.size && !this.dirtyS.size && !freshChanged && !quiet) return
    this.lastEmit = Date.now()
    const values: Record<string, unknown> = {}
    for (const k of this.dirtyV) if (this.values[k]) values[k] = this.values[k]
    const status: Record<string, unknown> = {}
    for (const k of this.dirtyS) status[k] = this.status[k]
    this.dirtyV.clear(); this.dirtyS.clear()
    this.emit({
      type: 'delta', values, status, stale: [...this.stale],
      ...(this.engine?.health() ?? {}),
      sources: this.source(),
    })
  }

  private tickAlarms(dtMs: number): void {
    if (!this.engine || this.closed) return
    for (const a of this.engine.evaluate(this.values, this.stale, dtMs)) this.emit({ type: 'alarm', alarm: a })
  }
}
