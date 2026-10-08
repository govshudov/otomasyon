# 1.4.0.0 → 1.6.0.0 değişiklikleri

Bu paket, kurulu `timescale-rt.jar` (1.6.0.0) dosyasını üreten kaynağın
tamamıdır.

**Doğrulama:** Bu kaynak derlendiğinde çıkan 31 sınıfın tamamı, kurulu
jar'ın içindeki sınıflarla **bayt bayt aynıdır**. Yani elinizdeki kaynak,
çalışan jar'ın kaynağının ta kendisi — benzeri değil.

---

## 1.5.0.0 — Cihaz bulma

**Sorun:** Blokların `deviceOrd` varsayılanı sabit bir tahmindi:
`station:|slot:/Drivers/TimescaleNetwork/TimescaleDatabase`. Başka bir
istasyonda cihazın adı farklı olunca (palette'ten sürükleyince varsayılan ad
`TimescaleDevice`'tır) ORD çözülemiyor, blok "deviceOrd çözülemedi" diye
duruyordu. Hata mesajı da yardımcı olmuyordu — sadece çözülemeyen yolu
yazıyor, istasyonda ne olduğunu söylemiyordu.

**Değişen dosyalar**

| Dosya | Durum |
|---|---|
| `src/com/akyllyoy/timescale/TsDeviceLookup.java` | **yeni** |
| `src/com/akyllyoy/timescale/BTimescaleTableWriter.java` | `findDevice()` değişti |
| `src/com/akyllyoy/timescale/BTimescaleHistoryExport.java` | `findDevice()` değişti |

**Davranış:** ORD tutmazsa istasyon taranır.

- Tek bir `TimescaleDevice` varsa → o kullanılır ve `deviceOrd` özelliği
  ona göre düzeltilir, böylece property sheet'te ne olduğu görünür
- Birden fazla varsa → seçim yapılmaz, hata metni adayları tam ORD'larıyla
  listeler
- Hiç yoksa → "önce palette'ten TimescaleNetwork ve içine TimescaleDevice
  ekleyin"

Tarama derinliği 12 ile sınırlı; cihazın altına inilmez.

---

## 1.6.0.0 — pgjdbc `LazyCleaner` meşgul döngüsü

**Sorun:** pgjdbc'nin temizlik thread'i `run()`'ın ilk satırında
`Thread.setContextClassLoader(null)` çağırır. Niagara'nın SecurityManager'ı
bunu reddeder. Fırlayan istisna **aynı döngünün kendi `catch(Throwable)`
bloğunda** yakalanıp `goto 0` ile başa dönülür. Hiç bloklama yok:

```
run():
  0:   Thread.setContextClassLoader(null)   ← reddedilir, istisna
  ...
  139: catch(Throwable) → log WARNING
  152: goto 0                                ← başa dön
```

**Ölçüm:** İzni reddeden bir SecurityManager altında **3 saniyede
3.225.728 uyarı**. Gerçek istasyonda log yazma hızı bunu ~330/sn'ye
sınırlıyor ama çıktı akışını boğuyor ve bir çekirdeği dolduruyordu.
Kullanıcının gönderdiği 262 KB'lik `output.txt` yalnızca **2 saniyeyi**
kapsıyordu.

**Değişen dosyalar**

| Dosya | Durum |
|---|---|
| `src/org/postgresql/util/LazyCleaner.java` | **yeni** — pgjdbc'nin sınıfını ezer |
| `build.sh` | kopyalama sırası + yama doğrulaması |
| `test/TsLazyCleanerTest.java` | **yeni** |

**Yama:** pgjdbc'nin `LazyCleaner` sınıfı, izin verilmeyen iki çağrı
(`setContextClassLoader`, `setUncaughtExceptionHandler`) olmadan yeniden
yazıldı. Geri kalan her şey aynı: `ReferenceQueue` izleme, thread TTL'i,
`Cleanable` / `CleaningAction` semantiği, kayıt ve silme.

**`build.sh`'de sıra kritik.** Kendi sınıflarımız artık pgjdbc açıldıktan
**sonra** kopyalanır — ters sırada yama etkisiz kalırdı. Betik ayrıca
yamanın gerçekten uygulandığını `cmp` ile doğrular; uygulanmazsa derleme
hata verip durur, sessizce eski davranışa dönmez.

**Niçin `niagara.security.manager.disable` kullanılmadı:** Böyle bir
Niagara özelliği var ve sorunu çözerdi, ama istasyonun SecurityManager'ını
topyekûn kapatarak. Kütüphanenin tek bozuk sınıfını düzeltmek doğru yer.

---

## Bu pakette ek olarak (1.6 jar'ından sonra)

| Dosya | Durum |
|---|---|
| `test/TsBootstrap.java` | **yeni** |
| `test/run-tests.sh` | hazırlık adımı eklendi |

`TsWriterSqlTest` ve `TsPolicyTest`, `niagara` şemasının zaten var olduğunu
varsayıyordu. Eski çalışma ortamında bu doğruydu (önceki koşular bırakmıştı),
ama **sıfırdan bir veritabanında** takım `schema "niagara" does not exist`
ile çöküyordu. `TsBootstrap` şemayı ve tabloları en başta oluşturur.

Bu yalnızca test altyapısıdır — jar'a girmez, sınıflar etkilenmez.

---

## Derleme

```bash
./build.sh /path/to/Niagara-4.15.1.16 lib/postgresql-42.7.2.jar
```

SDK klasöründe `bin/ext/nre.jar` ve `modules/` altında `baja`, `driver-rt`,
`ndriver-rt`, `history-rt`, `alarm-rt`, `control-rt`, `bql-rt` olmalı.

Çıktı: `build/timescale-rt.jar` — **imzasız**. İmzalamak için
`IMZA-ANAHTARI.md`.

## Test

```bash
./test/run-tests.sh /path/to/Niagara-4.15.1.16
```

Yerel PostgreSQL gerekir:

```sql
CREATE ROLE niagara_rw LOGIN SUPERUSER PASSWORD 'Ts_Test_2026!';
CREATE DATABASE scada OWNER niagara_rw;
```

**175 test**, üç aşamada:

| Takım | Test |
|---|---|
| `TsLazyCleanerTest` | 12 |
| `TsNoExtensionTest` | 12 |
| `TsPolicyTest` | 19 |
| `TsWriterSqlTest` | 67 |
| `TsHistoryExportTest` | 42 |
| `TsIntegrationTest` | 23 |

Sandbox'ta gerçek timescaledb eklentisi olmadığı için `create_hypertable`
ve politika fonksiyonları stub olarak tanımlanır; `TsNoExtensionTest` ise
tam tersini doğrular, o yüzden koşucu stub'ları o testten önce kaldırır.
Sıra önemlidir.
