import { Fragment, useEffect, useMemo, useState } from 'react'
import { DEMO, NIAGARA } from '../data/niagara'
import {
  TEMP_ALL, TEMP_OLCEG, diffFromAuto, isTempLike, loadTempPlan, merge, onTempPlan, saveTempOverrides, unusedTemps,
  type TempMap, type TempPlan,
} from '../data/nasosTemp'
import { useCikar, type CikarRow } from './cikar'
import { Icon } from './icons'

/**
 * Arhiw → Sazlamalar: nasos temperaturası noktalarının eşlemesi (data/nasosTemp.ts).
 * Tablo: nasos × (U1…W2, Öň, Arka) — her hücrede grafiklerin okuduğu veritabanı noktası;
 * kendiliğinden tanınan (Toplum_1_Temps_P3_U1 …) açılır listeden değiştirilebilir.
 * "Ýatda sakla" kaydetmeyi tek fonksiyona bırakır (saveTempOverrides).
 */

type Cell = 'auto' | 'over' | 'none'

export function SazlamaPage({ sid }: { sid: string }) {
  const [plan, setPlan] = useState<TempPlan | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<TempMap>({})
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<{ info: string; text?: string } | null>(null)
  const [ver, setVer] = useState(0)

  useEffect(() => onTempPlan(() => setVer((v) => v + 1)), [])
  useEffect(() => {
    let ok = true
    loadTempPlan(sid).then((p) => { if (!ok) return; setPlan(p); setSel(p.eff); setDirty(false) },
      (e) => { if (ok) setErr(String(e?.message ?? e)) })
    return () => { ok = false }
  }, [sid, ver])

  // Açılır listenin seçenekleri: önce temperatura noktaları, sonra diğerleri
  const opts = useMemo(() => {
    const pts = plan?.points ?? []
    const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
    return {
      temp: pts.filter(([n, , , u]) => isTempLike(n, u)).map(([n]) => n).sort(cmp),
      other: pts.filter(([n, , , u]) => !isTempLike(n, u)).map(([n]) => n).sort(cmp),
    }
  }, [plan])

  const unused = useMemo(() => (plan ? unusedTemps(plan.pumps, plan.points, sel) : []), [plan, sel])

  const cellOf = (pid: string, key: string): Cell => {
    const v = sel[pid]?.[key] ?? null
    return !v ? 'none' : (plan?.auto[pid]?.[key] ?? null) === v ? 'auto' : 'over'
  }
  const set = (pid: string, key: string, v: string) => {
    setSel((s) => merge(s, { [pid]: { [key]: v || null } }))
    setDirty(true); setMsg(null)
  }

  const save = async () => {
    if (!plan) return
    const r = await saveTempOverrides(sid, diffFromAuto(plan.auto, sel))
    setMsg(r.stored
      ? { info: 'Ýatda saklandy (bu brauzerde). Grafikler täze saýlawy ulanýar.' }
      : { info: 'Bu sessiýada grafikler täze saýlawy eýýäm ulanýar. Hemişelik bolmagy üçin Workbench: Files → twin → nasos_temperatura.json faýlyna aşakdaky teksti ýazyň (faýl bar bolsa çalşyň).', text: r.text })
  }

  const counts = useMemo(() => {
    let auto = 0, over = 0, none = 0
    for (const p of plan?.pumps ?? []) for (const k of TEMP_ALL) {
      const c = cellOf(p.id, k)
      if (c === 'auto') auto++; else if (c === 'over') over++; else none++
    }
    return { auto, over, none }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, sel])

  // "Daşyna çykar": eşleme tablosu ve kullanılmayan noktalar
  useCikar(() => {
    if (!plan) return null
    const rows: CikarRow[] = []
    let last = 0
    for (const p of plan.pumps) {
      rows.push({ c: [p.toplum !== last ? `Toplum ${p.toplum}` : '', `${p.label} (P${p.k})`, ...TEMP_ALL.map((k) => sel[p.id]?.[k] ?? '—')] })
      last = p.toplum
    }
    return {
      kind: 'tables', title: 'Nasos temperaturasy nokatlary',
      kpi: [
        { l: 'Nasos sany', v: String(plan.pumps.length) },
        { l: 'Maglumat binýady', v: plan.points ? `${plan.points.length} nokat` : 'elýeterli däl' },
        { l: 'Awtomatik tanalan', v: String(counts.auto) },
        { l: 'Elde saýlanan', v: String(counts.over) },
        { l: 'Nokatsyz öýjük', v: String(counts.none) },
        { l: 'Ulanylmaýan nokat', v: String(unused.length) },
      ],
      tables: [
        { title: 'Nasos × ölçeg → maglumat binýadyndaky nokat', rows,
          cols: [{ t: 'Toplum' }, { t: 'Nasos' }, ...TEMP_ALL.map((k) => ({ t: TEMP_OLCEG[k] }))] },
        ...(unused.length ? [{ title: 'Ulanylmaýan temperatura nokatlary', rows: unused.map((u) => ({ c: [u.name, u.unit ?? '', u.why] })),
          cols: [{ t: 'Nokat' }, { t: 'Birlik' }, { t: 'Sebäbi' }] }] : []),
      ],
    }
  })

  if (err) return <div className="page"><div className="loading bad">ýükleme ýalňyşlygy: {err}</div></div>
  if (!plan) return <div className="page"><div className="cbEmpty">ýüklenýär…</div></div>

  const src = plan.saved ? (DEMO ? 'bu brauzerde ýatda saklanan saýlaw' : 'bu sessiýada üýtgedilen saýlaw')
    : Object.keys(plan.file).length ? 'nasos_temperatura.json' : 'awtomatik tanamak'
  let lastT = 0

  return (
    <div className="page saz">
      <div className="pageBar">
        <h2>Nasos temperaturasy nokatlary <small>{plan.pumps.length} nasos · çeşme: {src}</small></h2>
        <div className="spacer" />
        <button disabled={!dirty && !Object.keys(diffFromAuto(plan.auto, sel)).length}
                onClick={() => { setSel(merge(plan.auto, {})); setDirty(true); setMsg(null) }}>Awtomatik saýlawa gaýtar</button>
        <button className={dirty ? 'on' : ''} disabled={!dirty} onClick={save}><Icon.save size={15} /> Ýatda sakla</button>
      </div>

      <p className="note">
        Nokat ady awtomatik tanalýar: <code>Toplum_1_Temps_P3_U1</code> → Toplum 1-iň 3-nji nasosy · U1;
        soňy ýok ady (<code>Toplum2_Temps_P1</code>) → öň podşipnik; <code>_Arka</code> → arka podşipnik.
        Toplumdaky nasoslaryň tertibi beketiň konfigurasiýasyndan. Nädogry ýa-da tanalmadyk öýjügi sanawdan saýlaň.
      </p>
      {!plan.points && <p className="note bad">Maglumat binýady elýeterli däl (TsOkuma hyzmaty ýok): diňe nasos_temperatura.json görkezilýär.</p>}
      {msg && (
        <div className="sazMsg">
          <div>{msg.info}</div>
          {msg.text && (
            <>
              <textarea readOnly value={msg.text} rows={Math.min(18, msg.text.split('\n').length + 1)} onFocus={(e) => e.currentTarget.select()} />
              <button className="small" onClick={() => { void navigator.clipboard?.writeText(msg.text!).catch(() => {}) }}>Göçür</button>
            </>
          )}
        </div>
      )}
      {NIAGARA && !msg && dirty && <p className="note">“Ýatda sakla” faýlyň tekstini görkezer (Workbench bilen ýazylýar).</p>}

      <div className="sazWrap">
        <table className="dtbl sazTbl">
          <thead>
            <tr><th>Nasos</th>{TEMP_ALL.map((k) => <th key={k}>{TEMP_OLCEG[k]}</th>)}</tr>
          </thead>
          <tbody>
            {plan.pumps.map((p) => {
              const first = p.toplum !== lastT
              lastT = p.toplum
              return (
                <Fragment key={p.id}>
                {first && (
                  <tr className="grpRow">
                    <td colSpan={TEMP_ALL.length + 1}><b>Toplum {p.toplum}</b>
                      <span className="sub"> · {plan.pumps.filter((x) => x.toplum === p.toplum).length} nasos</span></td>
                  </tr>
                )}
                <tr>
                  <td className="sazNasos"><b>{p.label}</b> <span className="sub">P{p.k}</span></td>
                  {TEMP_ALL.map((k) => {
                    const v = sel[p.id]?.[k] ?? '', a = plan.auto[p.id]?.[k] ?? null, c = cellOf(p.id, k)
                    return (
                      <td key={k}>
                        <select className={`sazSel ${c}`} value={v} onChange={(e) => set(p.id, k, e.target.value)}
                                title={a ? `awtomatik: ${a}` : 'awtomatik tanalmady'}>
                          <option value="">— ýok —</option>
                          {v && !opts.temp.includes(v) && !opts.other.includes(v) && <option value={v}>{v}</option>}
                          <optgroup label="Temperatura nokatlary">
                            {opts.temp.map((n) => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                          <optgroup label="Beýleki nokatlar">
                            {opts.other.map((n) => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                        </select>
                      </td>
                    )
                  })}
                </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="sazLegend">
        <span><i className="auto" />awtomatik tanalan · {counts.auto}</span>
        <span><i className="over" />elde saýlanan · {counts.over}</span>
        <span><i className="none" />nokat ýok · {counts.none}</span>
      </div>

      <h3 className="rptH">Ulanylmaýan temperatura nokatlary <small>{unused.length}</small></h3>
      <table className="dtbl">
        <thead><tr><th>Nokat</th><th>Birlik</th><th>Sebäbi</th></tr></thead>
        <tbody>
          {!unused.length && <tr><td colSpan={3} className="emptyRow">Ýok — maglumat binýadyndaky ähli temperatura nokatlary ulanylýar.</td></tr>}
          {unused.map((u) => <tr key={u.name}><td className="mono">{u.name}</td><td>{u.unit ?? '—'}</td><td>{u.why}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}
