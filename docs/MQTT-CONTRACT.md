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
    "flow_m3h": 812.4,
    "discharge_press_bar": 3.81,
    "vfd_freq_hz": 47.0,
    "current_a": 196.2,
    "power_kw": 116.0,
    "run_hours": 4211.6,
    "MOTOR.temp": 66.1,
    "PUMP.vib": 2.3
  }
}
```

Pompa başına sinyal seti bilerek sade tutulur — yukarıdaki 8 sinyal, eksiksiz liste
budur (`common/equipment_types.json` → `pump_hsc`). Sıcaklık motorda, titreşim pompa
gövdesinde ölçülür.

- `ts` — epoch milisaniye (UTC)
- `v` — sinyal sözlüğü. Anahtar formatı:
  - Ekipman seviyesi sinyal: `<measurement>` → `flow_m3h`
  - Bileşen seviyesi sinyal: `<COMPONENT>.<measurement>` → `MOTOR.temp`

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
PS-01.PMP-01.MOTOR.temp     (bileşen seviyesi)
PS-01.PMP-01.flow_m3h       (ekipman seviyesi)
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
`kind`: `overheat` (motor) | `vibration` (pompa gövdesi) | `vfd_trip` | `sensor_dropout` | `clear`

`sensor_dropout` için `component` yayınlanmayacak sinyalin anahtarıdır: `MOTOR.temp`
ya da `PUMP.vib`.
