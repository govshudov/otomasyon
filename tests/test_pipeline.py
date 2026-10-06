"""Faz 1 kabul testi: simülatör → yayıncı → depo → alarm motoru.

MQTT broker'a ihtiyaç duymaz — sahte istemci mesajları yakalar, gerçek
yönlendirme kodundan geçirir. Böylece zincirin tamamı Docker olmadan doğrulanır.
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "sim"), str(ROOT / "api")]

from alarms import ACKED_ALM, UNACK_ALM, AlarmEngine          # noqa: E402
from ingest import route                                       # noqa: E402
from plant import Plant                                        # noqa: E402
from publisher import DeadbandPublisher                        # noqa: E402
from store import TagStore                                     # noqa: E402

STATION = json.loads((ROOT / "stations/ps-01.json").read_text(encoding="utf-8"))
TYPES = json.loads((ROOT / "common/equipment_types.json").read_text(encoding="utf-8"))["types"]
SID = STATION["station_id"]


class FakeClient:
    """paho arayüzünü taklit eder, mesajları biriktirir."""

    def __init__(self):
        self.msgs: list[tuple[str, str]] = []

    def publish(self, topic, payload, qos=0, retain=False):
        self.msgs.append((topic, payload))


class Rig:
    def __init__(self, seed=7, noise=False):
        self.plant = Plant(STATION, seed=seed)
        self.client = FakeClient()
        self.store = TagStore()
        self.alarms = AlarmEngine()
        self.alarms.load([STATION], TYPES)
        eq_types = {e["id"]: e["type"] for e in STATION["equipment"]}
        self.pub = DeadbandPublisher(self.client, SID, TYPES, eq_types,
                                     random.Random(seed + 1), noise=noise)
        self.raw_signal_count = 0

    def run(self, seconds: float, dt: float = 1.0, pub_every: float = 1.0):
        """Simülasyonu ilerletir, yayınlar, yakalanan mesajları depoya yönlendirir."""
        t = 0.0
        next_pub = 0.0
        while t < seconds:
            self.plant.step(dt)
            t += dt
            if t >= next_pub:
                next_pub = t + pub_every
                snap = self.plant.snapshot()
                self.raw_signal_count += sum(len(d["v"]) for d in snap.values())
                self.pub.publish_snapshot(snap, self.plant.dropouts())
                for topic, payload in self.client.msgs:
                    route(topic, payload.encode() if isinstance(payload, str) else payload,
                          self.store, None)
                self.client.msgs.clear()
                self.alarms.evaluate(self.store, pub_every)


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"  {'✓' if cond else '✗'} {name}" + (f"  — {detail}" if detail else ""))
    return cond


def test_heartbeat_and_clamping() -> bool:
    """Regresyon: (a) ölü bandı aşmayan sinyal de heartbeat ile yayınlanmalı,
    (b) gürültülü değer sinyalin ölçüm aralığının dışına taşmamalı."""
    import time as _t
    print("\n[8] Heartbeat ve ölçüm aralığı kırpması")
    rig = Rig(seed=9, noise=True)
    rig.run(60, dt=1.0, pub_every=1.0)          # depoyu doldur, sonra sıfırla
    seen_before = set(rig.store.values)
    rig.store.values.clear()

    # Gerçek zaman ilerlemeden heartbeat tetiklenmez; last_full'ü geriye al.
    for k in rig.pub.last_full:
        rig.pub.last_full[k] -= rig.pub.HEARTBEAT_S + 1
    rig.run(2, dt=1.0, pub_every=1.0)

    missing = seen_before - set(rig.store.values)
    ok = check("heartbeat tüm sinyalleri yeniden yayınladı", not missing,
               f"{len(rig.store.values)}/{len(seen_before)} tag geri geldi"
               + (f", eksik: {sorted(missing)[:3]}" if missing else ""))

    out_of_range = []
    for tag, s in rig.store.values.items():
        eq = tag.split(".")[1]
        key = ".".join(tag.split(".")[2:])
        tdef = TYPES.get(next((e["type"] for e in STATION["equipment"] if e["id"] == eq), ""), {})
        sd = tdef.get("signals", {}).get(key, {})
        r = sd.get("range")
        if r and isinstance(s.v, (int, float)) and not isinstance(s.v, bool):
            if s.v < r[0] - 1e-9 or s.v > r[1] + 1e-9:
                out_of_range.append(f"{tag}={s.v} ∉ {r}")
    ok &= check("hiçbir değer ölçüm aralığı dışında değil", not out_of_range,
                "; ".join(out_of_range[:3]) or f"{len(rig.store.values)} tag kontrol edildi")
    return ok


def test_rack_cleaner() -> bool:
    """Izgara temizleme tarağı çevrim boyunca gerçekten inip çıkıyor mu?

    3D'deki hareket bu sinyale bağlı; sinyal sabit kalırsa tarak da donuk kalır.
    Çöp birikmesini beklemek yerine tetikleyip doğrudan ölçüyoruz.
    """
    print("\n[9] Izgara temizleme tarağı hareketi")
    rig = Rig(seed=13)
    rack = rig.plant.racks["RACK-01"]
    rack.debris = rack.trigger + 0.02          # temizliği hemen tetikle
    positions, currents = [], []
    for _ in range(int(rack.clean_duration) + 30):
        rig.plant.step(1.0)
        sig = rack.signals()
        positions.append(sig["RACK__CLEANER.position_pct"])
        currents.append(sig["RACK__CLEANER.motor_current_a"])

    ok = check("temizlik çevrimi başladı", max(currents) > 5,
               f"motor akımı tepe {max(currents):.1f} A")
    ok &= check("tarak tam stroka çıktı", max(positions) > 95,
                f"en yüksek konum %{max(positions):.0f}")
    ok &= check("tarak park konumuna döndü", positions[-1] < 5,
                f"son konum %{positions[-1]:.1f}")
    # Üçgen dalga: birden fazla tur olmalı (tek geçişte temizlemez)
    peaks = sum(1 for a, b, c in zip(positions, positions[1:], positions[2:])
                if b > a and b >= c and b > 90)
    ok &= check("birden fazla tur yaptı", peaks >= 2, f"{peaks} tepe")
    ok &= check("temizlik bitince akım kesildi", currents[-1] == 0.0,
                f"{currents[-1]:.1f} A")
    return ok


def test_station_isolation() -> bool:
    """Çok istasyonlu kurulumda alarmlar birbirine sızıyor mu?

    Ekipman kimlikleri istasyonlar arasında TEKRARLANIR — her tesiste PMP-01
    vardır. Sağlık anahtarları istasyonla nitelenmezse PS-02'nin arızası
    PS-01'in pompasını kırmızıya boyar. Sahada bu felaket olurdu.
    """
    import time as _t
    print("\n[10] Çok istasyonlu izolasyon")
    all_stations = [json.loads((ROOT / f"stations/ps-0{i}.json").read_text(encoding="utf-8"))
                    for i in (1, 2, 3)]
    eng = AlarmEngine()
    n = eng.load(all_stations, TYPES)
    store = TagStore()
    now = int(_t.time() * 1000)
    for sid in ("PS-01", "PS-02", "PS-03"):
        store.ingest_telemetry(sid, "PMP-01", now, {"MOTOR.t1": 40.0})
    store.ingest_telemetry("PS-02", "PMP-01", now, {"MOTOR.t1": 150.0})
    for _ in range(4):
        eng.evaluate(store, 1.0)

    ok = check("üç istasyonun kuralları yüklendi", n > 150, f"{n} kural")
    ch = eng.health_by_component()
    ok &= check("yalnız arızalı istasyonun pompası işaretli",
                list(ch) == ["PS-02.PMP-01/MOTOR"], str(list(ch)))
    ok &= check("diğer istasyon filtresi temiz", eng.health_by_component("PS-01") == {})
    ok &= check("alarm listesi istasyona göre süzülüyor",
                len(eng.active("PS-02")) >= 1 and eng.active("PS-01") == [],
                f"PS-02: {len(eng.active('PS-02'))}, PS-01: {len(eng.active('PS-01'))}")
    ok &= check("anlık görüntü istasyona göre filtreleniyor",
                all(t.startswith("PS-02.") for t in store.snapshot("PS-02")["values"]),
                f"{len(store.snapshot('PS-02')['values'])} tag")
    return ok


def main() -> int:
    ok = True
    print("\n[1] Zincir uçtan uca veri taşıyor mu?")
    rig = Rig()
    rig.run(1200, dt=1.0, pub_every=1.0)
    tags = rig.store.values
    ok &= check("tag deposu doldu", len(tags) >= 100, f"{len(tags)} tag")
    ok &= check("bileşen seviyeli tag var",
                f"{SID}.PMP-01.MOTOR.t1" in tags and f"{SID}.PMP-01.PUMP.bearing2" in tags,
                "PMP-01.MOTOR.t1, PMP-01.PUMP.bearing2")
    pump_tags = sorted(t.split(".", 2)[2] for t in tags if t.startswith(f"{SID}.PMP-01."))
    ok &= check("pompa başına 16 sinyal (izleme panosu: 8 sıcaklık + 8)", len(pump_tags) == 16,
                ", ".join(pump_tags))
    ok &= check("ekipman durumu geldi", f"{SID}.PMP-01" in rig.store.status,
                rig.store.status.get(f"{SID}.PMP-01", {}).get("state", "?"))

    print("\n[2] Ölü bant gerçekten sıkıştırıyor mu?")
    ok &= check("mesaj sayısı ham sinyal sayısından çok düşük",
                rig.pub.tx_count < rig.raw_signal_count * 0.15,
                f"{rig.pub.tx_count} mesaj / {rig.raw_signal_count} ham sinyal örneği")

    print("\n[3] Fizik anlamlı mı?")
    lvl = tags[f"{SID}.BASIN-01.level_m"].v
    running = sum(1 for p in rig.plant.pumps.values() if p.is_running)
    temps = {p.id: max(tags[f"{SID}.{p.id}.MOTOR.t{k}"].v for k in range(1, 7))
             for p in rig.plant.pumps.values() if p.is_running}
    hot = max(temps, key=temps.get)
    t_hot = temps[hot]
    ok &= check("havuz seviyesi güvenli bantta", 0.8 < lvl < 5.9, f"{lvl:.2f} m")
    ok &= check("pompalar devreye girdi", running >= 1, f"{running} pompa çalışıyor")
    ok &= check("çalışan pompanın motoru ısındı", 40 < t_hot < 110, f"{hot} {t_hot:.1f} °C")
    ok &= check("hiçbir motor uyarı eşiğine çıkmadı",
                all(t < 110 for t in temps.values()),
                ", ".join(f"{k} {v:.0f}°" for k, v in sorted(temps.items())))

    print("\n[4] Arıza enjeksiyonu doğru bileşeni alarma sokuyor mu?")
    rig2 = Rig(seed=11)
    rig2.run(900)
    victim = next(p.id for p in rig2.plant.pumps.values() if p.is_running)
    rig2.plant.inject(victim, "MOTOR", "overheat", 1.0)
    rig2.run(2400)
    act = rig2.alarms.active()
    hit = [a for a in act if a["equipment"] == victim and a["component"] == "MOTOR"]
    ok &= check("motor sıcaklık alarmı doğdu", bool(hit),
                hit[0]["msg"] if hit else "alarm yok")
    ok &= check("alarm seviyesi ALARM'a yükseldi",
                any(a["level"] == "ALARM" for a in hit),
                ", ".join(sorted({a["level"] for a in hit})) or "—")
    ch = rig2.alarms.health_by_component()
    key = f"{SID}.{victim}/MOTOR"
    ok &= check("bileşen sağlığı istasyon+düğüm adıyla eşleşiyor",
                ch.get(key) == "ALARM", f"{key} = {ch.get(key)}")
    ok &= check("başka pompa etkilenmedi",
                not any(a["equipment"] != victim and a["component"] == "MOTOR"
                        for a in act))

    print("\n[5] Alarm onay (ack) durum makinesi")
    target = hit[0]
    ok &= check("onay öncesi UNACK_ALM", target["state"] == UNACK_ALM, target["state"])
    acked = rig2.alarms.ack(target["id"], "test")
    ok &= check("onay sonrası ACKED_ALM", acked.state == ACKED_ALM, acked.state)
    rig2.plant.inject(victim, None, "clear")
    rig2.run(3600)
    still = [a for a in rig2.alarms.active()
             if a["equipment"] == victim and a["component"] == "MOTOR"]
    ok &= check("arıza temizlenince aktif alarm kalmadı",
                not any(a["state"] in ("UNACK_ALM", "ACKED_ALM") for a in still),
                ", ".join(f"{a['level']}:{a['state']}" for a in still) or "hiç")
    ok &= check("onaylanmamış alarm RTN_UNACK olarak duruyor (ISA 18.2)",
                all(a["state"] == "RTN_UNACK" for a in still),
                f"{len(still)} kayıt onay bekliyor")
    rig2.alarms.ack_all("test")
    gone = [a for a in rig2.alarms.active()
            if a["equipment"] == victim and a["component"] == "MOTOR"]
    ok &= check("onaylanınca listeden düştü", not gone, f"{len(gone)} kaldı")

    print("\n[6] Sensör kaybı 'VERİ YOK' üretiyor mu?")
    rig3 = Rig(seed=5)
    rig3.run(600)
    live = next(p.id for p in rig3.plant.pumps.values() if p.is_running)
    tag = f"{SID}.{live}.MOTOR.t1"
    before = rig3.store.values[tag].ts
    rig3.plant.inject(live, "MOTOR.t1", "sensor_dropout")
    rig3.run(600)
    ok &= check("sensör kaybı sonrası tag güncellenmedi",
                rig3.store.values[tag].ts == before,
                f"{rig3.pub.suppressed} sinyal bastırıldı")

    print("\n[7] Sürücü tripi pompayı düşürüyor mu?")
    rig4 = Rig(seed=3)
    rig4.run(900)
    victim = next(p for p in rig4.plant.pumps.values() if p.is_running)
    rig4.plant.inject(victim.id, None, "vfd_trip")
    rig4.run(60)
    ok &= check("pompa FAULT durumuna geçti", victim.state == "FAULT", f"{victim.id} {victim.state}")
    rig4.run(600)
    others = sum(1 for p in rig4.plant.pumps.values() if p.is_running)
    ok &= check("yedek pompa devraldı", others >= 1, f"{others} pompa çalışıyor")

    ok &= test_heartbeat_and_clamping()
    ok &= test_rack_cleaner()
    ok &= test_station_isolation()

    print("\n" + ("TÜM TESTLER GEÇTİ ✓" if ok else "BAZI TESTLER BAŞARISIZ ✗") + "\n")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
