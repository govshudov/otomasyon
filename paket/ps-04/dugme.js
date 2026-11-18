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
// Popup'taki "Grafigi aç" mesajla ({twin:'egri-ac'}) nasosun H–Q penceresini ister: burada Px
// sayfasının ortasında büyük çerçeve açılır (nasos.html?egri#PMP-03); ×, Esc ya da dışarıya tıklama kapatır.
// Deneme: dugme.html?demo#PMP-03 → popup ve grafik örnek değerlerle (demo/px-test.html).
(function () {
  'use strict'
  var m = location.pathname.match(/([^\/]+)\.html$/i)
  var id = decodeURIComponent(location.hash.slice(1)).toUpperCase()
  if (!id && m && !/^dugme$/i.test(m[1])) id = decodeURIComponent(m[1]).toUpperCase()
  var KAT = 'twinNasosKatman', EGRI = 'twinEgriKatman'
  // JACE'te /file/twin/; geliştirmede (Vite, demo/px-test.html) dugme.html'in yanı
  var BASE = /^\/file\//.test(location.pathname) ? '/file/twin/' : location.pathname.replace(/[^\/]*$/, '')
  var DEMO = /[?&]demo(&|=|$)/.test(location.search)
  var GEN = 255, ARA = 12, KENAR = 8

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

  /** ortala: dikeyde kutunun ortasına; değilse yerinde kalır, yalnız ekrandan taşmaz */
  function yerles(f, b, ortala) {
    var vw = ust.innerWidth, vh = ust.innerHeight
    var w = Math.min(GEN, vw - 2 * KENAR), h = f.offsetHeight || 240
    var left = b.right + ARA + w <= vw - KENAR ? b.right + ARA
      : b.left - ARA - w >= KENAR ? b.left - ARA - w : vw - w - KENAR
    var y0 = ortala || !f.style.top ? b.top + b.h / 2 - h / 2 : parseFloat(f.style.top)
    var top = Math.max(KENAR, Math.min(y0, vh - h - KENAR))
    f.style.left = Math.round(left) + 'px'
    f.style.top = Math.round(top) + 'px'
    f.style.width = w + 'px'
  }

  function ac() {
    var d = ust.document, b = kutu()
    yap()
    var f = d.createElement('iframe')
    f.id = KAT
    f.src = BASE + 'nasos.html' + (DEMO ? '?demo' : '') + '#' + encodeURIComponent(id)
    f.title = id
    Object.assign(f.style, {
      position: 'fixed', zIndex: '2147483000', height: '240px', maxHeight: (ust.innerHeight - 2 * KENAR) + 'px',
      border: '1px solid #526e83', borderRadius: '10px', background: '#405667',
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)', colorScheme: 'dark',
      visibility: 'hidden',
    })
    yerles(f, b, true)
    d.body.appendChild(f)
    // Popup, kart gerçek boyunu alana kadar (nasos.html çerçeve yüksekliğini yazar) gizli kalır;
    // sonra bir kez ortalanıp gösterilir. Önce tahmini boyla gösterip sonra kaydırmak zıplatıyordu.
    var goster = function () {
      if (f.style.visibility !== 'hidden') return
      yerles(f, b, true)
      f.style.visibility = 'visible'
    }
    try {
      var RO = ust.ResizeObserver || window.ResizeObserver
      if (RO) {
        f.__ro = new RO(function () {
          if (f.style.visibility === 'hidden') { if (f.style.height !== '240px') goster() }
          else yerles(f, b, false)
        })
        f.__ro.observe(f)
      }
    } catch (e) { /* yok */ }
    setTimeout(goster, 1500)   // boy bildirilmezse yine de göster
  }

  function egriYap() {
    var k = ust.document.getElementById(EGRI)
    if (k) k.parentNode.removeChild(k)
  }

  /** Nasosun H–Q penceresi: Px sayfasının ortasında büyük çerçeve, arkası hafif karartılır.
   *  Küçük popup yerinde kalır. */
  function egriAc(nid, demo) {
    var d = ust.document
    egriYap()
    var s = d.createElement('div')
    s.id = EGRI
    Object.assign(s.style, {
      position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', zIndex: '2147483001',
      display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.45)',
    })
    var f = d.createElement('iframe')
    f.src = BASE + 'nasos.html?egri' + (demo ? '&demo' : '') + '#' + encodeURIComponent(nid)
    f.title = nid + ' H–Q'
    Object.assign(f.style, {
      width: Math.round(Math.min(900, ust.innerWidth * 0.94)) + 'px', height: Math.round(Math.min(680, ust.innerHeight * 0.92)) + 'px',
      border: '1px solid #526e83', borderRadius: '12px', background: '#405667',
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)', colorScheme: 'dark',
    })
    // pencere boyu değişince de sığsın (min() bilmeyen eski tarayıcıda yukarıdaki px kalır)
    f.style.width = 'min(900px, 94vw)'
    f.style.height = 'min(680px, 92vh)'
    // Esc çerçevenin içinde de çalışsın: odak çerçeveye
    f.addEventListener('load', function () { try { f.contentWindow.focus() } catch (e) { /* yok */ } })
    s.addEventListener('click', function (e) { if (e.target === s) egriYap() })
    s.appendChild(f)
    d.body.appendChild(s)
  }

  // Esc üst belgede de popup'ı (H–Q penceresi açıksa önce onu) kapatsın; mesajlar (bir kez bağlanır)
  try {
    if (!ust.__twinNasosEsc) {
      ust.__twinNasosEsc = true
      ust.document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return
        if (ust.document.getElementById(EGRI)) egriYap(); else yap()
      })
      ust.addEventListener('message', function (e) {
        var msg = e.data
        if (!msg || typeof msg !== 'object') return
        if (msg.twin === 'nasos-yap') yap()
        else if (msg.twin === 'egri-yap') egriYap()
        // yalnız kendi popup'ımızdan (aynı köken), nasos belgisi sade olmalı
        else if (msg.twin === 'egri-ac' && e.origin === location.origin && /^[\w-]{1,24}$/.test(String(msg.id))) {
          egriAc(String(msg.id), !!msg.demo)
          if (e.source) e.source.postMessage({ twin: 'egri-acyk' }, '*')
        }
      })
    }
  } catch (e) { /* yok */ }

  document.addEventListener('click', function (e) { e.preventDefault(); if (id) ac() })
})()
