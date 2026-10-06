"""İsimlendirme standardını KOD İLE dayatan kayıt defteri.

Bu dosyanın varlık sebebi tek bir cümle: 3D modelde arıza gösterilecek her nokta,
veri modelinde bir sinyali olan her bileşenle birebir eşleşmek zorunda. İnsan eliyle
isim yazıldığında bu eşleşme er ya da geç bozulur. Burada üretici, `equipment_types.json`
kataloğunu okur ve ürettiği düğümleri kataloğa karşı doğrular:

  * katalogda olup modelde üretilmemiş bileşen  -> EKSİK  (arıza gösterilemez)
  * modelde olup katalogda tanımsız bileşen     -> FAZLA  (veri bağlanamaz)

İkisi de üretimi durdurur. Böylece model ile veri modeli ayrışamaz.

İsim biçimi:
    PMP-01                        ekipman kökü
    PMP-01__MOTOR__BEARING-DE     ekipman + bileşen (bileşen kendi içinde __ içerebilir)
    STATIC__CIVIL                 yapısal, ekipman değil
"""
from __future__ import annotations

import re

import bpy

NAME_RE = re.compile(r"^[A-Z][A-Z0-9-]*(__[A-Z0-9-]+)*$")


class NamingError(Exception):
    pass


class Registry:
    """Üretilen her nesneyi kaydeder, adlandırır ve katalogla çapraz doğrular."""

    def __init__(self, station: dict, types: dict):
        self.station_id = station["station_id"]
        self.types = types
        self.eq_cfg = {e["id"]: e for e in station["equipment"]}
        self.nodes: dict[str, bpy.types.Object] = {}
        self.by_equipment: dict[str, list[str]] = {}
        self.components: dict[str, set[str]] = {}      # ekipman -> üretilen bileşenler
        self.static: list[str] = []

    # ------------------------------------------------------------------ #

    def _tag(self, ob: bpy.types.Object, name: str, **props) -> bpy.types.Object:
        if not NAME_RE.match(name):
            raise NamingError(f"isim standarda uymuyor: {name!r}")
        if name in self.nodes:
            raise NamingError(f"yinelenen düğüm adı: {name!r}")
        ob.name = name
        if ob.data is not None:
            ob.data.name = name
        for k, v in props.items():
            if v is not None:
                ob[k] = v                      # glTF `extras` olarak dışa aktarılır
        self.nodes[name] = ob
        return ob

    def root(self, eq_id: str) -> bpy.types.Object:
        """Ekipmanın kök düğümü — bileşenlerin ortak ebeveyni.

        Frontend "tüm pompayı seç / gizle / patlat" diyebilmek için bir gruba
        ihtiyaç duyar. Kök, orijinde birim dönüşümlü boş bir nesnedir; böylece
        çocukların dünya konumu ebeveynlik sırasında hiç değişmez.
        """
        if eq_id in self.nodes:
            return self.nodes[eq_id]
        cfg = self.eq_cfg[eq_id]
        empty = bpy.data.objects.new(eq_id, None)
        empty.empty_display_size = 0.4
        bpy.context.collection.objects.link(empty)
        self.by_equipment.setdefault(eq_id, []).append(eq_id)
        return self._tag(empty, eq_id, station=self.station_id, equipment=eq_id,
                         eq_type=cfg["type"], label=cfg.get("label", eq_id),
                         is_root=True)

    def equipment(self, ob: bpy.types.Object, eq_id: str,
                  component: str | None = None) -> bpy.types.Object:
        """Bir ekipmanı ya da onun bir bileşenini kaydeder."""
        cfg = self.eq_cfg.get(eq_id)
        if cfg is None:
            raise NamingError(f"istasyon konfigürasyonunda yok: {eq_id}")
        eq_type = cfg["type"]
        tdef = self.types.get(eq_type, {})

        if component is not None:
            if component not in tdef.get("components", {}):
                raise NamingError(
                    f"{eq_id} ({eq_type}) tipinde tanımsız bileşen: {component!r}\n"
                    f"  katalogdakiler: {sorted(tdef.get('components', {}))}")
            name = f"{eq_id}__{component}"
            self.components.setdefault(eq_id, set()).add(component)
            ob.parent = self.root(eq_id)          # kök orijinde ve birim dönüşümlü
        else:
            name = eq_id

        self.by_equipment.setdefault(eq_id, []).append(name)
        return self._tag(ob, name, station=self.station_id, equipment=eq_id,
                         eq_type=eq_type, component=component,
                         label=tdef.get("components", {}).get(component, {}).get("label")
                         if component else cfg.get("label", eq_id))

    def structural(self, ob: bpy.types.Object, part: str) -> bpy.types.Object:
        """Ekipman olmayan yapısal eleman (beton, platform, korkuluk…)."""
        name = f"STATIC__{part}"
        self.static.append(name)
        return self._tag(ob, name, station=self.station_id, static=True)

    # ------------------------------------------------------------------ #

    def validate(self) -> None:
        """Katalog ile model arasındaki her ayrışmayı hata olarak bildirir."""
        problems: list[str] = []

        for eq_id, cfg in self.eq_cfg.items():
            tdef = self.types.get(cfg["type"], {})
            declared = set(tdef.get("components", {}))
            built = self.components.get(eq_id, set())

            if eq_id not in self.by_equipment:
                problems.append(f"EKSİK EKİPMAN  {eq_id} ({cfg['type']}) hiç üretilmedi")
                continue

            # Yalnızca SİNYALİ OLAN bileşenler zorunludur — arıza ancak sinyali
            # olan bir noktada gösterilebilir. Salt görsel bileşenler serbesttir.
            with_signals = {c for c in declared
                            if any(k.startswith(c + ".") for k in tdef.get("signals", {}))}
            missing = with_signals - built
            if missing:
                problems.append(
                    f"EKSİK BİLEŞEN  {eq_id}: {sorted(missing)}\n"
                    f"               bu bileşenlerin sinyali var ama 3D karşılığı yok — "
                    f"arıza gösterilemez")

        if problems:
            raise NamingError("model ile veri modeli ayrışmış:\n\n" +
                              "\n".join("  " + p for p in problems))

    def report(self) -> str:
        lines = [f"  {len(self.nodes)} düğüm  ({len(self.by_equipment)} ekipman, "
                 f"{len(self.static)} yapısal)"]
        for eq_id in sorted(self.by_equipment):
            tdef = self.types.get(self.eq_cfg[eq_id]["type"], {})
            declared = set(tdef.get("components", {}))
            built = self.components.get(eq_id, set())
            with_signals = {c for c in declared
                            if any(k.startswith(c + ".") for k in tdef.get("signals", {}))}
            lines.append(f"    {eq_id:10s} {len(built):2d}/{len(declared):2d} bileşen "
                         f"({len(with_signals & built)} sinyalli)")
        return "\n".join(lines)


# --------------------------------------------------------------------------- #

def build_twin_map(reg: Registry, camera: dict) -> dict:
    """3D düğüm ↔ tag eşleme dosyası. Frontend'in okuyacağı sözleşme.

    Model üreticisi bunu kendisi yazar: hangi bileşeni ürettiyse onun sinyal
    slotlarını açar. Elle tutulan bir eşleme dosyası her model değişiminde bayatlar.
    """
    out: dict = {"station": reg.station_id, "schema_version": "0.1.0", "equipment": {}}

    for eq_id, cfg in reg.eq_cfg.items():
        if eq_id not in reg.by_equipment:
            continue
        tdef = reg.types.get(cfg["type"], {})
        signals = tdef.get("signals", {})
        built = reg.components.get(eq_id, set())

        eq_signals, comps = {}, {}
        for key, sd in signals.items():
            entry = {"tag": f"{reg.station_id}.{eq_id}.{key}",
                     "label": sd.get("label", key), "unit": sd.get("unit"),
                     "type": sd.get("type", "float"), "range": sd.get("range"),
                     "alarms": sd.get("alarms", [])}
            if "." in key:
                comp, meas = key.split(".", 1)
                if comp in built:
                    c = comps.setdefault(comp, {
                        "node": f"{eq_id}__{comp}",
                        "label": tdef["components"][comp].get("label", comp),
                        "signals": {}})
                    c["signals"][meas] = entry
            else:
                eq_signals[key] = entry

        # Sinyali olmayan ama modelde var olan bileşenler de haritada dursun —
        # üzerine dokunulduğunda en azından adı ve ekipman bağlamı gösterilebilir.
        for comp in sorted(built):
            comps.setdefault(comp, {
                "node": f"{eq_id}__{comp}",
                "label": tdef["components"][comp].get("label", comp),
                "signals": {}})

        out["equipment"][eq_id] = {
            "type": cfg["type"], "label": cfg.get("label", eq_id),
            "node": eq_id, "signals": eq_signals, "components": comps,
            "camera": camera.get(eq_id),
        }
        for comp, c in comps.items():
            c["camera"] = camera.get(f"{eq_id}__{comp}")

    out["static"] = sorted(reg.static)
    return out
