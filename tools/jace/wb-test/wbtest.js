// Workbench'in gömülü tarayıcısı (WebBrowser kutusu) sayfayı nereden ve hangi oturumla açıyor?
// İstasyonda file:^twin/wbtest.html olarak durur; Px'te WebBrowser ord = file:^twin/wbtest.html.
// Ekrandaki yazının tamamı kopyalanıp geri gönderilir. Hiçbir şey yazmaz, yalnız okur.
(function () {
  'use strict'
  var o = document.getElementById('o'), satir = []
  function yaz(k, v) { satir.push(k + ': ' + v); o.textContent = satir.join('\n') }
  yaz('href', location.href)
  yaz('origin', location.origin)
  yaz('referrer', document.referrer || '-')
  yaz('ua', navigator.userAgent)
  yaz('cerez', document.cookie ? 'var (' + document.cookie.split(';').length + ')' : 'yok/gorunmuyor')
  var ust = 'yok'
  try { ust = window.top === window ? 'kendisi (cerceve yok)' : String(window.top.location.href) } catch (e) { ust = 'baska koken: ' + e.name }
  yaz('ust pencere', ust)
  function dene(ad, url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      return r.text().then(function (t) {
        var giris = /login|j_security_check|prelogin/i.test(r.url + ' ' + t.slice(0, 3000))
        yaz(ad, r.status + ' ' + (r.redirected ? 'yonlendi→ ' + r.url + ' ' : '') + (giris ? 'GIRIS ISTIYOR' : 'tamam'))
      })
    }).catch(function (e) { yaz(ad, 'HATA ' + e) })
  }
  dene('/file/twin/stations.json', '/file/twin/stations.json')
    .then(function () { return dene('./stations.json', './stations.json') })
    .then(function () { return dene('/ord/file:^twin/stations.json', '/ord/file:%5Etwin/stations.json') })
    .then(function () { return dene('/ord?station:|slot:/', '/ord?station:%7Cslot:/') })
    .then(function () { yaz('bitti', new Date().toISOString()) })
})()
