// Eski TV Px sayfasındaki nasos düğmesi.
// Workbench'te nasos resminin üstüne bir WebBrowser kutusu konur, ord'u:
//   file:^twin/dugme/PMP-03.html
// Kutu saydamdır; üzerine gelince çerçevesi görünür, tıklanınca AYNI pencerede, Px sayfasının
// üstünde nasos popup'ı açılır (file:^twin/nasos.html#PMP-03). Popup açıkken sayfanın geri
// kalanı kapalıdır; × ya da Esc ile kapanır.
(function () {
  'use strict'
  var m = location.pathname.match(/([^\/]+)\.html$/i)
  var id = m ? decodeURIComponent(m[1]).toUpperCase() : ''
  var KAT = 'twinNasosKatman'
  var BASE = '/file/twin/'

  // Popup'ı Px sayfasının en üst belgesine kur (aynı köken); olmazsa bir üst çerçeveye
  var ust = window.parent
  try { if (window.top.document) ust = window.top } catch (e) { /* başka köken */ }

  document.documentElement.setAttribute('data-id', id)
  document.title = id

  function yap() {
    var k = ust.document.getElementById(KAT)
    if (k) k.parentNode.removeChild(k)
  }

  function ac() {
    var d = ust.document
    yap()
    var k = d.createElement('div')
    k.id = KAT
    Object.assign(k.style, {
      position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', zIndex: '2147483000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(6, 18, 28, 0.62)',
    })
    // Arka plana tıklamak bir şey yapmaz (yalnız × / Esc kapatır), alttaki sayfaya da geçmez
    k.addEventListener('mousedown', function (e) { e.stopPropagation() })
    k.addEventListener('click', function (e) { e.stopPropagation() })
    var f = d.createElement('iframe')
    f.src = BASE + 'nasos.html#' + encodeURIComponent(id)
    f.title = id
    Object.assign(f.style, {
      width: '440px', height: '320px', maxWidth: '94vw', maxHeight: '92vh',
      border: '1px solid #2c526d', borderRadius: '10px', background: '#1f394c',
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)', colorScheme: 'dark',
    })
    k.appendChild(f)
    d.body.appendChild(k)
    try { f.focus() } catch (e) { /* yok */ }
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
