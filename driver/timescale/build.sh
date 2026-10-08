#!/usr/bin/env bash
# =====================================================================
#  timescale-rt.jar - Niagara modul derleme betigi (Gradle'siz)
#
#  Bu betik Niagara'nin Gradle eklentilerine ihtiyac duymadan, dogrudan
#  javac + jar ile bir Niagara modul jar'i uretir. Uretilen jar
#  Tridium'un kendi modulleriyle ayni yapidadir:
#     META-INF/MANIFEST.MF
#     META-INF/module.xml     <- tip kayit defteri
#     module.palette
#     timescale-rt.lexicon
#     com/akyllyoy/timescale/*.class
#     org/postgresql/**       <- pgjdbc gomulu (varsa)
#
#  Kullanim:  ./build.sh /path/to/niagara-jars /path/to/postgresql.jar
# =====================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${1:-/mnt/user-data/uploads/Niagara-4.15.1.16}"
PGJDBC="${2:-}"
# alt kabukta 'cd' yapildigi icin mutlak yola cevir
[ -n "$PGJDBC" ] && PGJDBC="$(cd "$(dirname "$PGJDBC")" && pwd)/$(basename "$PGJDBC")"

MODULE_NAME="timescale"
PROFILE="rt"
SYMBOL="ts"
VENDOR="Akyllyoy"
VENDOR_VERSION="1.6.0.0"
NIAGARA_DEP_VERSION="4.15"
DESCRIPTION="Niagara to TimescaleDB history / point / alarm export driver"

SRC="$HERE/timescale/timescale-rt/src"
OUT="$HERE/build"
CLASSES="$OUT/classes"
STAGE="$OUT/stage"
JAR="$OUT/${MODULE_NAME}-${PROFILE}.jar"

CP="$SDK/bin/ext/nre.jar"
for m in baja driver-rt ndriver-rt history-rt alarm-rt control-rt bql-rt; do
  CP="$CP:$SDK/modules/$m.jar"
done

rm -rf "$OUT"
mkdir -p "$CLASSES" "$STAGE/META-INF"

echo "==> javac (--release 8)"
find "$SRC" -name '*.java' > "$OUT/sources.txt"
javac --release 8 -nowarn -proc:none -encoding UTF-8 \
      -d "$CLASSES" -cp "$CP" @"$OUT/sources.txt"

if [ -n "$PGJDBC" ] && [ -f "$PGJDBC" ]; then
  echo "==> pgjdbc gomuluyor: $(basename "$PGJDBC")"
  TMP="$OUT/pg"
  mkdir -p "$TMP"
  ( cd "$TMP" && unzip -oq "$PGJDBC" )
  rm -rf "$TMP/META-INF/MANIFEST.MF" "$TMP/META-INF"/*.SF "$TMP/META-INF"/*.RSA \
         "$TMP/META-INF"/*.DSA "$TMP/META-INF"/*.EC "$TMP/META-INF/maven" 2>/dev/null || true
  cp -r "$TMP/." "$STAGE/"
  PG_VER="$(basename "$PGJDBC")"
else
  echo "!!! pgjdbc verilmedi - modul derlenir ama calisma aninda baglanamaz"
  PG_VER="YOK"
fi

# DIKKAT - SIRA ONEMLI: kendi siniflarimiz pgjdbc'den SONRA kopyalanir.
# src/org/postgresql/util/LazyCleaner.java, pgjdbc'nin ayni adli sinifini
# bilerek EZER (Niagara SecurityManager'i altinda sonsuz mesgul donguye
# giren setContextClassLoader cagrisi cikarilmis surumu). Sira ters
# olursa yama etkisiz kalir.
echo "==> siniflar kopyalaniyor (pgjdbc uzerine)"
cp -r "$CLASSES/." "$STAGE/"

# Yamanin gercekten uygulandigini dogrula: aksi halde sessizce eski
# davranisla kalirdik.
if [ -f "$CLASSES/org/postgresql/util/LazyCleaner.class" ]; then
  if cmp -s "$CLASSES/org/postgresql/util/LazyCleaner.class" \
            "$STAGE/org/postgresql/util/LazyCleaner.class"; then
    echo "    LazyCleaner yamasi uygulandi"
  else
    echo "!!! HATA: LazyCleaner yamasi UYGULANMADI" >&2
    exit 1
  fi
fi

echo "==> kaynak dosyalar"
cp "$HERE/timescale/timescale-rt/module.palette" "$STAGE/module.palette"
cp "$HERE/timescale/timescale-rt/module.lexicon" "$STAGE/${MODULE_NAME}-${PROFILE}.lexicon"

echo "==> META-INF/module.xml"
BUILD_MILLIS="$(date +%s000)"
BUILD_HOST="claude-build"
cat > "$STAGE/META-INF/module.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<module name="${MODULE_NAME}-${PROFILE}" bajaVersion="0" vendor="${VENDOR}" vendorVersion="${VENDOR_VERSION}" description="${DESCRIPTION}" preferredSymbol="${SYMBOL}" nre="true" autoload="true" installable="true" buildMillis="${BUILD_MILLIS}" buildHost="${BUILD_HOST}" moduleName="${MODULE_NAME}" runtimeProfile="${PROFILE}">
 <dependencies>
  <dependency name="alarm-rt" vendor="Tridium" vendorVersion="${NIAGARA_DEP_VERSION}"/>
  <dependency name="baja" vendor="Tridium" vendorVersion="${NIAGARA_DEP_VERSION}"/>
  <dependency name="control-rt" vendor="Tridium" vendorVersion="${NIAGARA_DEP_VERSION}"/>
  <dependency name="driver-rt" vendor="Tridium" vendorVersion="${NIAGARA_DEP_VERSION}"/>
  <dependency name="history-rt" vendor="Tridium" vendorVersion="${NIAGARA_DEP_VERSION}"/>
  <dependency name="ndriver-rt" vendor="Tridium" vendorVersion="${NIAGARA_DEP_VERSION}"/>
 </dependencies>
 <dirs/>
 <types>
  <type name="TimescaleNetwork" class="com.akyllyoy.timescale.BTimescaleNetwork"/>
  <type name="TimescaleDevice" class="com.akyllyoy.timescale.BTimescaleDevice"/>
  <type name="TimescaleDeviceFolder" class="com.akyllyoy.timescale.BTimescaleDeviceFolder"/>
  <type name="TimescaleTableWriter" class="com.akyllyoy.timescale.BTimescaleTableWriter"/>
  <type name="TimescaleHistoryExport" class="com.akyllyoy.timescale.BTimescaleHistoryExport"/>
 </types>
 <permissions>
   <niagara-permission-groups type="all"/>
  <niagara-permission-groups type="workbench"/>
  <niagara-permission-groups type="station">
   <req-permission>
    <name>NETWORK_COMMUNICATION</name>
    <purposeKey>TimescaleDB (PostgreSQL) sunucusuna JDBC baglantisi</purposeKey>
    <parameters>
     <parameter name="hosts" value="*"/>
     <parameter name="ports" value="*"/>
    </parameters>
   </req-permission>
  </niagara-permission-groups>
 </permissions>
</module>
XML

echo "==> META-INF/MANIFEST.MF"
cat > "$OUT/manifest.txt" <<MF
Manifest-Version: 1.0
Implementation-Version: ${VENDOR_VERSION}
Implementation-Vendor: ${VENDOR}
MF

echo "==> jar"
( cd "$STAGE" && jar cfm "$JAR" "$OUT/manifest.txt" . )

echo
echo "TAMAM: $JAR"
echo "  boyut     : $(du -h "$JAR" | cut -f1)"
echo "  pgjdbc    : $PG_VER"
echo "  siniflar  : $(find "$CLASSES" -name '*.class' | wc -l)"
