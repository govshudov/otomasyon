# 13 Ekim güncellemesi: arayüz sadeleştirme + 3D giriş yapısı

İzleme sunumundaki geri bildirim: "sıralama yok, karmaşık, kullanması zor, sadeleştirilmeli".
Bu güncellemeyle arayüz sadeleşti ve 3D'deki giriş yapısı düzeltildi.

**Durum:** Mac'te yerel geliştirme modunda (Vite + API, canlı veri yok) denendi; tip denetimi
ve derleme temiz. **Niagara içinde henüz çalıştırılmadı. `paket/` klasörleri yeniden üretilmedi**
(1. bilgisayarda yapılacak, §3).

## 1. Arayüz

### Menü
Sıra operatörün iş akışına göre, 7 öğe yerine 6:

**Umumy syn** (açılış) → **Sanly ekiz** → **Duýduryşlar** → **Grafikler** → **Hasabatlar** → **Karta**

- **Toplumlar alt menüsü kalktı.** Umumy syn zaten bütün toplumları gösteriyor; alttaki çubukta
  her toplumun kutusu ayrı (kuwwat, her boru için akym, jemi göwrüm, basyş).
- **2D shema kalktı.** Sanly ekiz doğrudan 3D açar. 2D'de olup başka yerde olmayan **girýän akym**
  ve **howuz göwrümi**, Umumy syn'in alt çubuğunda Suw derejesi kutusuna taşındı.

### Her ekrana tek yol
Her ekran yalnız soldaki menüden açılır; sayfalar arası kısayol yok.

| Ne | Önce | Şimdi |
|---|---|---|
| Nasosyň 8 grafigi | Pompa kartına tıklama, 3D kartındaki "8 grafigi aç", Grafikler'deki düğmeler (açılır pencere) | Yalnız **Grafikler**: üstte tek seçici `Beket \| Nasos 1 … \| Ähli nokatlar` (pencere yok) |
| Duýduryşlar | Menü, başlıktaki istasyon adı, başlıktaki son duýduryş | Yalnız **menü**; başlıktakiler yalnız gösterge |
| Toplum görünümü | Umumy syn, Toplumlar alt menüsü | **Umumy syn** |
| Ekipmanı 3D'de açmak | 3D'de tıklama, duýduryş satırına tıklama | **3D'de tıklama** |
| İstasyon seçimi | 3D'nin üst çubuğu | **Başlık**; tek istasyon varsa (sahada hep) seçici yok, yalnız ad |

### Adlar
Ekipmanın ekranda tek adı var. Kaynak adlar (`stations/*.json`, twin-map, Niagara noktaları)
**değişmedi**; çeviri adların arayüze girdiği yerde yapılıyor (`web/src/data/pump.ts` → `enjamAdy`).

| Önce | Şimdi |
|---|---|
| `NASOS 1` / `T-1 N-1` / `PMP-01` | **Nasos 1** (numara istasyon içinde tek) |
| `T-3 esasy turba` | **Esasy turba 3** (1 Maý'da T-3 turbası Toplum 1'e bağlı; "T-" toplum sanılıyordu) |
| `N-2 basyş klapany`, `N-2 suwuň derejesi` | **Nasos 2 basyş klapany**, **Nasos 2 suwuň derejesi** |
| Teknik kodlar (`PMP-01`, `HDR-01`, `LT-01`) | Ekrandan kalktı |
| Başlıkta "Suw bekedi" (her istasyonda aynı) | İstasyonun adı, ör. **Ýaşyldepe suw göteriji beket** |

Duýduryş metinleri de aynı adla gösterilir ("Nasos 1 — …").

### Diğer
- **Umumy syn yerleşimi (1 Maý):** Toplumlar eşit genişlikte iki sütundaydı; 7 nasoslu Toplum 1 taştığı
  için kartlar üst üste biniyordu. Artık toplumlar sığdıkça yan yana, sığmazsa alt alta; kartlar
  (230 px) satıra sığmazsa alt satıra geçiyor. Hiçbir ekranda üst üste binme ya da yana taşma yok.
- **Hasabat:** "Döwürde inw." / "Döwürde transf." sütunları → **Inwertorda** / **Transformatorda**
  (alt yazı "döwürde sag"). CSV başlıkları da aynı.
- **Silinen dosyalar:** `web/src/ui/Schema2D.tsx`, `Hud.tsx`, `Alarms.tsx` (artık kullanılmıyordu).

## 2. 3D model

- **Giriş perdesi:** Magtymguly (PS-01) ve 1 Maý (PS-04) için de açıldı
  (`stations/ps-0x.json` → `geometry.bridge.gate_wall_t: 0.5`; Ýaşyldepe'de dün açılmıştı).
  Üç istasyonun köprüsü aynı. KURULUM.md'deki not düzeltildi.
- **Kapak ve ızgara** (`tools/genmodel/intake.py`):
  - Kule köprü üstünde 2,3 m yerine **1,5 m** (`TOWER` sabiti).
  - Üstte **motorlu tahrik ünitesi**: taban plakası, redüktör, fan kapaklı motor, klemens kutusu,
    kollu el çarkı (`_drive`). Motor dışa bakıyor.
  - Siyah parçalar (kapağın mekanizması, ızgaranın tarağı) gövdeyle **tek renk** (`MACHINE`).
    Pompa kaplini ve pencerelerdeki koyu renge dokunulmadı.
- **Kapak açıklığı için yapı hazır, veri eklenmedi:** Kapak kanadı ayrı, hareketli parça (3 m strok);
  arayüz `GATE-01/position_pct` gelirse kanadı ona göre yukarı/aşağı kaydırır (%0 / %50 / %100
  denendi). Veri hazır olunca:
  1. `tools/jace/deploy.mjs` ve `tools/jace/twin-history.mjs` içindeki `USED` listesine
     `slide_gate: ['position_pct']` ekle.
  2. `make kur ... ADIM=8 BITIR=9` → `/Twin/<kod>/GATE-01/position_pct` açılır, history eklenir.
  3. Workbench'te noktayı PLC'deki kapak konumuna bağla.
- **Modeller:** Beş istasyon da bu Mac'te Blender 5.2.1 ile yeniden üretildi →
  `web/public/models/ps-0{1..5}.{glb,twin-map.json}`. Ýaşyldepe'nin çıktısı dünkü (1. bilgisayar)
  ile bayt bayt aynıydı, yani üretim iki bilgisayarda aynı sonucu veriyor. Ayrıca:
  - PS-01 / PS-04 twin-map'lerinde dünkü "Panoda → Transformatorda" adı eksikti, girdi.
  - PS-02 / PS-03 (demo) modelleri 6 Ekim'den kalmaydı; dünkü boru/kolektör koduyla yenilendi.

## 3. 1. bilgisayarda yapılacaklar

`paket/` henüz eski (ps-01 ve ps-04 paketleri dünkü metin düzeltmesinden de önce). Kurulum
betiğinin 8. adımı `paket\<kod>` varsa arayüzü oradan yükler; **paket yenilenmeden kurulursa eski
arayüz gider.** Her istasyon için (önce Ýaşyldepe ile deneyin):

```
git pull
make model AYAR=ayarlar/yasyldepe.json                  # build\ps-05-plain.glb (paket bunu kullanır)
make paket AYAR=ayarlar/yasyldepe.json                  # paket\ps-05
make kur   AYAR=ayarlar/yasyldepe.json ADIM=8 BITIR=8   # o istasyon ÇALIŞIRKEN: arayüz + eksik Twin noktaları
```

Sonra `https://127.0.0.1/file/twin/index.html` → **Ctrl+F5**. Sorun yoksa `ayarlar/1-may.json` ve
`ayarlar/magtymguly.json` ile tekrarlayın, yeni `paket/` klasörlerini commit edin.

**Eski dosyalar:** `deploy.mjs` istasyondaki eski dosyaları yalnız `OLD` listesindeyse siler. Yeni
paket kurulunca şimdikilerin silinmesi için `OLD` listesine ekleyin (dünkü "12 Ekim paketleri"
satırının yanına):

```
'assets/index-BAfEfuXV.js', 'assets/index-DAS0sHPs.js', 'assets/index-lJ809osB.js', 'assets/index-BxgeSIVI.css'
```

### Niagara'da kontrol listesi
- [ ] Menü 6 öğe, sayfa Umumy syn ile açılıyor
- [ ] Başlıkta istasyonun adı; tek istasyonda seçici yok
- [ ] 1 Maý Umumy syn: kartlar üst üste binmiyor, yana taşmıyor (Toplum 2 için aşağı kaydırma normal)
- [ ] Grafikler: `Beket | Nasos 1 … | Ähli nokatlar`; nasos seçince 8 grafik
- [ ] Hasabat: "Inwertorda" / "Transformatorda" sütunları
- [ ] Duýduryş metinleri "Nasos N — …" biçiminde (yerelde alarm olmadığı için görülemedi)
- [ ] 3D: giriş perdesi (üç istasyonda), kısa kuleler, motorlu tahrik üniteleri

## 4. Bekleyenler

- **Umumy syn pompa kartı sadeleştirme:** Kart ~570 px boyunda; küçük ekranda (1280×800) çok
  kaydırma var. Öneri: kartta ad + durum, ýagdaýy, 3 uyarı noktası, basyş / ýygylyk / tok / kuwwat
  sayı olarak, işlän wagty. 8 sıcaklık hücresi ve basyş mini grafiği karttan kalkar (Grafikler'de ve
  3D kartında duruyor). **Karar bekliyor:** 8 sıcaklık Umumy syn'den kalksın mı, yoksa kartta tek
  satır şerit olarak mı kalsın?
- **Tablolarda sütuna göre sıralama** (duýduryşlar, hasabat): henüz yok.
- **2. bilgisayarda nasosların uyuşmaması:** Sebebi kesinleşmedi. Bir dahaki taşımada üç kontrol:
  kopyadaki `<istasyon>\twin\stations.json` hangi kodu gösteriyor; Workbench → Config → Twin altında
  o kod var mı ve noktalar bağlı mı; istasyon değiştirince Ctrl+F5 yapıldı mı (üç istasyon aynı
  adresten açılıyor, tarayıcı önbelleği paylaşılıyor). Çalışan istasyonu taşırken
  `istasyon-kopyala.ps1 -TwinBirak` Twin noktalarını ve bağlantılarını korur.
