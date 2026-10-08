# 1.6.0.0 → 1.7.0.0 değişiklikleri

## Veri kaybı: watermark artık yazmayla aynı işlemde

**Sorun (1.6'ya kadar):** History export kayıtları yazma kuyruğuna veriyor ve
watermark'ı **hemen** ilerletiyordu; gerçek yazma kuyruğun kendi thread'inde,
sonra oluyordu. Kuyruk `DROP_OLDEST` politikasıyla kuruluydu: dolunca en eski
kaydı atıp yenisini kabul ediyordu, bu yüzden export'taki "kuyruk doluysa dur"
dalı hiç çalışmıyordu. Sonuç:

- Veritabanı birkaç tur (5 dk'lık turlarda ~10 dk) kapalı kalınca kuyruk
  dolar, en eski kayıtlar atılır — watermark çoktan ilerlemiş olduğu için
  **bir daha okunmazlar**. Veri Niagara history'sinde durur ama aktarılmaz.
- Station kapanırken kuyrukta bekleyen ve yazılamayan kayıtlar da aynı
  şekilde kaybolur.

**Düzeltme:** History export kuyruğu kullanmaz. Kayıtları `batchSize`'lık
partilerle kendisi yazar; her parti ve o partinin watermark'ı **tek işlemde**
commit edilir. Yazma başarısızsa işlem geri alınır, watermark yerinde kalır,
bir sonraki tur aynı yerden devam eder. Kuyruk kodu yerinde (canlı veri için);
SQL'i ortak `TsRowWriter`'a taşındı, davranışı aynı.

Ek: bir history'nin sonunda yalnız NaN kayıtlar varsa watermark onların da
üstüne geçer (1.6'da her tur aynı kayıtlar yeniden okunuyordu). Bu yalnız o
turdaki bütün partiler yazıldıysa yapılır.

| Dosya | Durum |
|---|---|
| `db/TsRowWriter.java` | **yeni** — history tablolarına + `point_live`'a yazan SQL (commit etmez) |
| `db/TsWriteQueue.java` | yazma SQL'i `TsRowWriter`'a taşındı |
| `db/TsExportState.java` | `markSuccess(..., commit)` — işlemi çağırana bırakan sürüm |
| `BTimescaleHistoryExport.java` | `pump` → `read` (yalnız okur); parti + watermark tek işlemde |

## Birim ve hassasiyet

`point.unit` hep boştu: export metadata'yı yazarken birimi okumuyordu. Artık
history config'indeki `valueFacets`'ten (history uzantısının noktadan aldığı
facet'ler) `units` sembolü ve `precision` okunup `point.unit` /
`point.precision`'a yazılır.

## Derleme (Windows)

```
node driver/timescale/build.mjs                       # Niagara'nın JDK 8'i ile
powershell -File driver\timescale\imzala.ps1          # p12 şifresini jarsigner sorar
```

`build.sh` (Linux) de 1.7.0.0'a güncellendi.

## Test

`test/TsExportTxTest.java` (**yeni**, 9 kontrol): parti + watermark birlikte
commit, commit öncesi hatada ikisinin birden geri alınması, çoğalmama, watermark'ın
geri gitmemesi, iki partide ikincisi hata verince ilkinin kalıcı ve watermark'ın
onun sonunda olması, kuyruğun ortak yazıcıyla yazması.

Ayrı bir veritabanı ister (`createdb ts_test`); şifre `PGPASSWORD`'dan okunur,
koda yazılmaz. Mevcut 175 test yeni sınıflarla derleniyor (çalıştırmak için
`scada` veritabanı ve `niagara_rw` rolü gerekir, bkz. 1.6 notu).
