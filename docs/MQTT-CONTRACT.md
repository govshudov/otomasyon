# MQTT Sözleşmesi

Simülatör ve gerçek PLC gateway'i **aynı** sözleşmeyi konuşur. PLC devreye alındığında
frontend'de ve API'de tek satır değişmez: `sim` servisi durur, `gateway` servisi başlar.

## Topic yapısı

| Topic | Retain | Açıklama |
|---|---|---|
| `twin/{station}/birth` | ✅ | Kaynak (sim/gateway) ayağa kalktı. İstasyon konfigürasyon özeti. |
| `twin/{station}/death` | ✅ | Last Will — kaynak düştü. Frontend "VERİ YOK" durumuna geçer. |
| `twin/{station}/{equipment}/t` | ❌ | Telemetri. Ölü bant (deadband) + 5 sn heartbeat ile yayınlanır. |
| `twin/{station}/{equipment}/s` | ✅ | Durum (state). Değişince yayınlanır, retain'li — geç bağlanan istemci son durumu alır. |
| `twin/{station}/cmd/fault` | ❌ | **Sadece simülatör.** Demo/geliştirme için arıza enjeksiyonu. |

## Yük (payload) formatı

### Telemetri — `twin/PS-01/PMP-01/t`
```json
{
  "ts": 1756640000123,
  "v": {
    "run_inv": true,
    "run_pano": false,
    "discharge_press_bar": 3.81,
    "vfd_freq_hz": 47.0,
    "current_a": 196.2,
    "power_kw": 116.0,
    "hours_inv": 4211.6,
    "hours_pano": 380.2,
    "MOTOR.t1": 86.1, "MOTOR.t2": 84.0, "MOTOR.t3": 85.2,
    "MOTOR.t4": 83.9, "MOTOR.t5": 86.8, "MOTOR.t6": 85.5,
    "PUMP.bearing1": 49.5, "PUMP.bearing2": 55.2
  }
}
```

Pompa başına 16 sinyal — pompa izleme panosunun eksiksiz listesi budur
(`common/equipment_types.json` → `pump_hsc`):

| Sinyal | Anlamı |
|---|---|
| `run_inv` / `run_pano` | Pompa inverterden / panodan (bypass) çalışıyor. İkisi de `false` = duruyor |
| `hours_inv` / `hours_pano` | Ayrı çalışma süreleri (sayaç, sa). Toplamı arayüz hesaplar |
| `discharge_press_bar` | Pompanın basma basıncı |
| `vfd_freq_hz`, `current_a`, `power_kw` | Ýygylyk, tok, kuwwat |
| `MOTOR.t1` … `MOTOR.t6` | 6 nasos sıcaklığı (sargı). Uyarı > 110 °C, näsazlyk > 130 °C |
| `PUMP.bearing1`, `PUMP.bearing2` | 2 podşipnik sıcaklığı. Uyarı > 80 °C, näsazlyk > 95 °C |

Esasy turba (`header`): `flow_m3h` (akym), `total_m3` (debimetre sayacı), `press_bar`.
Toplumun kuwwaty = o turbaya basan pompaların `power_kw` toplamı (arayüzde hesaplanır).

Arayüzdeki üç uyarı kategorisi sinyallerden türetilir: **Temperatura** (8 sıcaklığın en
kötüsü), **Tok** (`current_a` eşikleri), **Suw derejesi** (`BASIN-01.level_m` eşikleri).
Her biri kadaly / duýduryş / näsazlyk.

- `ts` — epoch milisaniye (UTC)
- `v` — sinyal sözlüğü. Anahtar formatı:
  - Ekipman seviyesi sinyal: `<measurement>` → `current_a`
  - Bileşen seviyesi sinyal: `<COMPONENT>.<measurement>` → `MOTOR.t1`

`<COMPONENT>` **birebir 3D model düğüm adıdır**. Böylece bir sinyalden 3D'de hangi
parçanın boyanacağı ek eşleme olmadan bulunur.

### Durum — `twin/PS-01/PMP-01/s` (retain)
```json
{ "ts": 1756640000123, "state": "RUNNING", "health": "OK", "mode": "AUTO" }
```

| Alan | Değerler |
|---|---|
| `state` | `STOPPED` `STARTING` `RUNNING` `STOPPING` `FAULT` `MAINT` |
| `health` | `OK` `WARN` `ALARM` `UNKNOWN` |
| `mode` | `AUTO` `MANUAL` `LOCAL` |

### Birth — `twin/PS-01/birth` (retain)
```json
{ "ts": 1756640000123, "source": "sim", "version": "0.1.0", "station": "PS-01",
  "equipment": ["BASIN-01","PMP-01","...","GATE-01"] }
```

## Tam tag kimliği

API ve frontend içinde bir sinyal şu şekilde adreslenir:

```
PS-01.PMP-01.MOTOR.t1       (bileşen seviyesi)
PS-01.PMP-01.current_a      (ekipman seviyesi)
```

Bu string; alarm kurallarında, geçmiş veri sorgularında, trend seçiminde ve
`twin-map.json` içinde tek anahtardır.

## Yayınlama kuralları

| Kural | Değer |
|---|---|
| Analog ölü bant | Sinyal tanımındaki `deadband` (yoksa aralığın %0.5'i) |
| Dijital | Her değişimde |
| Heartbeat | Değişmese de 5 sn'de bir tam yayın |
| QoS | Telemetri 0, durum/birth/death 1 |
| Maksimum yayın hızı | Ekipman başına 5 Hz |

## Arıza enjeksiyonu (yalnız simülatör)

`twin/PS-01/cmd/fault` topic'ine:
```json
{ "target": "PMP-01", "kind": "overheat", "severity": 1.0 }
```
`kind`: `overheat` (sargı T1–T6) | `bearing` (podşipnik) | `overcurrent` (tok) | `vfd_trip` |
`sensor_dropout` | `clear`

`sensor_dropout` için `component` yayınlanmayacak sinyalin anahtarıdır: `MOTOR.t1`
ya da `PUMP.bearing1` gibi.
