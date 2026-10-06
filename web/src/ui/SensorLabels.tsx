import { useEffect, useRef } from 'react'
import { fmt, readTag, useTwin } from '../data/store'
import type { TwinMap } from '../scene/types'
import { severity } from './InfoCard'

/** Ölçümü sahnede, datçiğin yanında sürekli gösterilen ekipman tipleri. */
const LABELED = new Set(['level_sensor'])

/**
 * Seviye datçiklerinin hemen yanında duran ölçüm yazıları ("2.90 m").
 *
 * Arka plan yok — gölgeli yazı. Konumu ve boyunu sahne yazar
 * (`TwinScene.setLabels`): yazı dünyada sabit boyda, yakınlaşınca büyür.
 * Tıklanmaz (pointer-events yok) — dokunuş alttaki datçiğe gider, kartı açar.
 */
export function SensorLabels({ twin, register }: {
  twin: TwinMap
  register: (items: { el: HTMLElement; equipment: string }[]) => void
}) {
  const values = useTwin((s) => s.values)
  const stale = useTwin((s) => s.stale)
  const refs = useRef(new Map<string, HTMLDivElement>())

  const items = Object.entries(twin.equipment)
    .filter(([, eq]) => LABELED.has(eq.type))
    .map(([id, eq]) => ({ id, sig: Object.values(eq.signals)[0] }))
    .filter((x) => x.sig)

  // Model (twin) değişince yazılar yeni modelin noktalarına bağlanır
  useEffect(() => {
    register(items.flatMap(({ id }) => {
      const el = refs.current.get(id)
      return el ? [{ el, equipment: id }] : []
    }))
    return () => register([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twin, register])

  return (
    <>
      {items.map(({ id, sig }) => {
        const raw = readTag(values, stale, sig.tag)
        const v = typeof raw === 'number' ? raw : null
        return (
          <div key={id} className={`sceneLabel ${severity(v, sig)}`}
               ref={(el) => { if (el) refs.current.set(id, el); else refs.current.delete(id) }}>
            {fmt(v ?? 0, sig.unit, 2) /* değer yoksa 0 (kullanıcı tercihi; kartta "maglumat ýok" kalır) */}
          </div>
        )
      })}
    </>
  )
}
