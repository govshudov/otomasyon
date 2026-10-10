# Kurulum dosyaları

Bu klasördeki kurulum dosyaları **Git'e girmez** (büyük). Proje klasörüyle birlikte USB ile
taşınır: istasyon PC'sinde `<proje>\gereksinimler\` altına kopyalanır.
`tools\kurulum\gereksinim-kur.ps1` dosyaları aşağıdaki SHA256 değerleriyle doğrular, sonra
kurar (KURULUM.md §2.0). Yalnız doğrulama: `gereksinim-kur.ps1 -Denetle`.

Eksik dosya aşağıdaki adresten indirilir. Adresler değişirse aynı sürümü bulup indirin,
sonra bu listedeki SHA256'yı güncelleyin.

| Dosya | Sürüm | Boyut | Kaynak | Ek doğrulama |
|---|---|---|---|---|
| `postgresql-18.1-1-windows-x64.exe` | PostgreSQL 18.1 | 369 MB | https://get.enterprisedb.com/postgresql/postgresql-18.1-1-windows-x64.exe | Dijital imza: EnterpriseDB Corporation |
| `timescaledb-2.23.1-postgresql-18-windows-amd64.zip` | TimescaleDB 2.23.1 (PG 18) | 7 MB | https://github.com/timescale/timescaledb/releases/download/2.23.1/timescaledb-postgresql-18-windows-amd64.zip | İçinde `timescaledb/setup.exe` |
| `node-v24.21.0-win-x64.zip` | Node.js 24.21.0 | 36 MB | https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip | `node-v24.21.0-SHASUMS256.txt` (Node.js'in resmi listesi) |
| `node-v24.21.0-SHASUMS256.txt` | — | 6 KB | https://nodejs.org/dist/v24.21.0/SHASUMS256.txt | — |
| `googlechromestandaloneenterprise64.msi` | Chrome (indirme günündeki sürüm) | 162 MB | https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi | Dijital imza: Google LLC. Adres hep son sürümü verir; yeniden indirilirse SHA256 değişir, aşağıyı güncelleyin. |
| `make-4.4.1-without-guile-w32-bin.zip` | GNU make 4.4.1 (ezwinports) | 0,4 MB | https://downloads.sourceforge.net/project/ezwinports/make-4.4.1-without-guile-w32-bin.zip | İçinde `bin/make.exe` |

İndirme tarihi: 2026-10-11. Niagara 4 burada yoktur (lisanslı Tridium kurulumu).

```sha256
f9c556921479782fcdd99c83ee1a4a69d5333d3f6c0dd5b7cb46ae39c4a95b8e  postgresql-18.1-1-windows-x64.exe
dfd27cb3c353f7e3087256f7a36e24240a49d465d0d772ef1b6709d3859ae9f5  timescaledb-2.23.1-postgresql-18-windows-amd64.zip
158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541  node-v24.21.0-win-x64.zip
f410428039e2c922a14058df067a4482691c9304a5c01a75847f9f3f2d3307f6  node-v24.21.0-SHASUMS256.txt
32ba438dea18f0fed1ec621bfb274a2669adec67be2aa91d96b3cc6c64779276  googlechromestandaloneenterprise64.msi
fb66a02b530f7466f6222ce53c0b602c5288e601547a034e4156a512dd895ee7  make-4.4.1-without-guile-w32-bin.zip
```
