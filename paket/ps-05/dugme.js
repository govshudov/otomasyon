// Eski TV Px sayfasındaki nasos düğmesi (dugme.html#PMP-03).
// Workbench'te nasos resminin üstüne bir WebBrowser kutusu konur, ord'u:
//   file:^twin/dugme/PMP-03.html
// O sayfa yalnız buraya yönlendirir: Niagara kutunun içini kendi dosya görünümüyle sarar ve
// sayfadaki dosya yollarını bozar; yönlendirme (meta refresh) bozulmaz. Sarmalayıcı sayfaların
// arka planı burada saydam yapılır, nasos resmi görünür.
// Kutu saydamdır; üzerine gelince çerçevesi görünür. Tıklanınca AYNI pencerede nasos popup'ı
// (file:^twin/nasos.html#PMP-03) tıklanan nasosun YANINDA açılır (sağında; yer yoksa solunda),
// nasosların üstünü kapatmaz, sayfa karartılmaz. Başka nasosa tıklamak popup'ı o nasosa geçirir;
// × ya da Esc kapatır.
(function () {
  'use strict'
  var m = location.pathname.match(/([^\/]+)\.html$/i)
  var id = decodeURIComponent(location.hash.slice(1)).toUpperCase()
  if (!id && m && !/^dugme$/i.test(m[1])) id = decodeURIComponent(m[1]).toUpperCase()
  var KAT = 'twinNasosKatman'
  var BASE = '/file/twin/'
  var GEN = 440, ARA = 14, KENAR = 8

  // Popup'ı Px sayfasının en üst belgesine kur (aynı köken); olmazsa bir üst çerçeveye
  var ust = window.parent
  try { if (window.top.document) ust = window.top } catch (e) { /* başka köken */ }

  document.documentElement.setAttribute('data-id', id)
  document.title = id

  /** Niagara'nın kutuyu sardığı ara sayfaları (dosya görünümü) saydam yap: nasos resmi görünsün.
   *  Yalnız adresinde "dugme" geçen sarmalayıcılara dokunulur; Px sayfasının kendisine değil. */
  function saydam() {
    var w = window
    try {
      while (w !== ust && w.frameElement) {
        var fe = w.frameElement
        fe.style.background = 'transparent'
        fe.setAttribute('allowtransparency', 'true')
        fe.setAttribute('scrolling', 'no')   // küçük kutuda kaydırma çubuğu çıkmasın
        w = w.parent
        if (w === ust || !/dugme/i.test(String(w.location.href))) break
        var d = w.document
        for (var el = fe.parentElement; el; el = el.parentElement) el.style.background = 'transparent'
        d.documentElement.style.background = 'transparent'
        d.documentElement.style.overflow = 'hidden'
        if (d.body) { d.body.style.background = 'transparent'; d.body.style.overflow = 'hidden' }
        var all = d.querySelectorAll('.window-bg, .bajaux-container, .hx, form, div')
        for (var i = 0; i < all.length; i++) all[i].style.background = 'transparent'
      }
    } catch (e) { /* yok */ }
  }
  saydam()
  // Sarmalayıcı sayfa geç çizilebilir: bir kez daha
  setTimeout(saydam, 800)

  function yap() {
    var k = ust.document.getElementById(KAT)
    if (k) { if (k.__ro) k.__ro.disconnect(); k.parentNode.removeChild(k) }
  }

  /** Bu düğmenin üst belgedeki ekran dikdörtgeni. Aradaki çerçevelerin ölçeği hesaba katılır
   *  (Px tuvali ekrana sığsın diye küçültülür). */
  function kutu() {
    var x = 0, y = 0, bw = window.innerWidth, bh = window.innerHeight, w = window
    try {
      while (w !== ust && w.frameElement) {
        var r = w.frameElement.getBoundingClientRect()
        var s = w.innerWidth ? r.width / w.innerWidth : 1
        x = r.left + x * s; y = r.top + y * s; bw *= s; bh *= s
        w = w.parent
      }
    } catch (e) { /* yok */ }
    return { left: x, top: y, right: x + bw, bottom: y + bh, w: bw, h: bh }
  }

  function yerles(f, b) {
    var vw = ust.innerWidth, vh = ust.innerHeight
    var w = Math.min(GEN, vw - 2 * KENAR), h = f.offsetHeight || 320
    var left = b.right + ARA + w <= vw - KENAR ? b.right + ARA
      : b.left - ARA - w >= KENAR ? b.left - ARA - w : vw - w - KENAR
    var top = Math.max(KENAR, Math.min(b.top + b.h / 2 - h / 2, vh - h - KENAR))
    f.style.left = Math.round(left) + 'px'
    f.style.top = Math.round(top) + 'px'
    f.style.width = w + 'px'
  }

  function ac() {
    var d = ust.document, b = kutu()
    yap()
    var f = d.createElement('iframe')
    f.id = KAT
    f.src = BASE + 'nasos.html#' + encodeURIComponent(id)
    f.title = id
    Object.assign(f.style, {
      position: 'fixed', zIndex: '2147483000', height: '320px', maxHeight: (ust.innerHeight - 2 * KENAR) + 'px',
      border: '1px solid #526e83', borderRadius: '10px', background: '#405667',
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)', colorScheme: 'dark',
    })
    yerles(f, b)
    d.body.appendChild(f)
    // Kart yüklenince çerçeve boyu değişir (nasos.html yazar): dikeyde yeniden ortala
    try {
      var RO = ust.ResizeObserver || window.ResizeObserver
      if (RO) { f.__ro = new RO(function () { yerles(f, b) }); f.__ro.observe(f) }
    } catch (e) { /* yok */ }
  }

  // Esc üst belgede de popup'ı kapatsın (bir kez bağlanır)
  try {
    if (!ust.__twinNasosEsc) {
      ust.__twinNasosEsc = true
      ust.document.addEventListener('keydown', function (e) { if (e.key === 'Escape') yap() })
      ust.addEventListener('message', function (e) { if (e.data && e.data.twin === 'nasos-yap') yap() })
    }
  } catch (e) { /* yok */ }

  document.addEventListener('click', function (e) { e.preventDefault(); if (id) ac() })
})()
