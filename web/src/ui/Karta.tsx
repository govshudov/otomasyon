import { NIAGARA } from '../data/niagara'
import { Icon } from './icons'

/**
 * "Karta" sayfası — istasyondaki harita Px'i (TV_PX/MAPS.px) sağdaki içerik
 * alanında, menü görünür kalacak şekilde çerçeve (iframe) içinde açılır.
 *
 * Niagara her sayfasında `X-Frame-Options: SAMEORIGIN` gönderir: Px yalnız
 * AYNI istasyondan açılmış bir sayfanın içinde gösterilebilir (6 Ekim'de
 * yerel istasyonda denendi). Bu yüzden arayüz bir istasyondan açıldığında
 * adres o istasyona göre kurulur; başka bir adresten açıldığında (geliştirme
 * sunucusu ya da haritası olmayan başka bir istasyon) tarayıcı gömmeyi
 * engeller — o durumda açıklama ve "täze bellikde aç" gösterilir.
 */

const KARTA_ORD = 'file:%5ETV_PX/MAPS.px'
/** İstasyon dışında (geliştirme) açılınca haritanın bulunduğu istasyon */
const KARTA_DEV_HOST = 'https://localhost'

export function kartaUrl(): string {
  return NIAGARA ? `/ord/${KARTA_ORD}` : `${KARTA_DEV_HOST}/ord/${KARTA_ORD}`
}

export function KartaPage() {
  const url = kartaUrl()
  const target = new URL(url, location.href)
  const same = target.origin === location.origin
  if (!same) {
    return (
      <div className="kartaMsg">
        <Icon.map size={34} />
        <h2>Karta bu ýerde açylyp bilmeýär</h2>
        <p>
          Karta <b>{target.origin}</b> stansiýasynda. Niagara öz sahypalaryny diňe şol stansiýadan
          açylan sahypanyň içinde görkezmäge rugsat berýär (X-Frame-Options: SAMEORIGIN),
          bu sahypa bolsa <b>{location.origin}</b> salgysyndan açyldy.
        </p>
        <p>Sanly ekizi kartanyň durýan stansiýasyndan açyň — şonda karta şu ýerde görkeziler.</p>
        <a className="btnLink" href={target.href} target="_blank" rel="noopener"><Icon.map size={16} /> Kartany täze bellikde aç</a>
      </div>
    )
  }
  return (
    <div className="karta">
      <iframe className="kartaFrame" src={url} title="Karta" />
      <a className="kartaPop" href={url} target="_blank" rel="noopener" title="Täze bellikde aç"><Icon.full size={15} /></a>
    </div>
  )
}
