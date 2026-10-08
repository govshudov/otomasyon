#!/usr/bin/env bash
# =====================================================================
#  Tum testleri sirayla calistirir.
#
#  DIKKAT - SIRA ONEMLI:
#  Sandbox'ta gercek timescaledb eklentisi yok; onun yerine
#  create_hypertable / add_*_policy / remove_*_policy STUB fonksiyonlari
#  kullaniliyor.
#
#  TsNoExtensionTest ise tam tersini dogruluyor: eklenti YOKKEN surucu
#  ne yapiyor. Bu yuzden once stub'lar KALDIRILIP o test calistirilir,
#  sonra stub'lar geri konup digerleri calistirilir.
# =====================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${1:-/mnt/user-data/uploads/Niagara-4.15.1.16}"

CP="$HERE/build/classes:$HERE/lib/postgresql-42.7.2.jar:$SDK/bin/ext/nre.jar"
for m in baja driver-rt ndriver-rt history-rt alarm-rt control-rt bql-rt; do
  CP="$CP:$SDK/modules/$m.jar"
done

rm -rf "$HERE/build/test"
javac -nowarn -proc:none -encoding UTF-8 -d "$HERE/build/test" -cp "$CP" \
      "$HERE"/test/*.java 2>&1 | grep -v "^Note:" || true

drop_stubs() {
  su postgres -c "psql -d scada -tAc \"SELECT 'DROP FUNCTION ' || oid::regprocedure || ';' FROM pg_proc WHERE proname IN ('create_hypertable','add_compression_policy','add_retention_policy','remove_compression_policy','remove_retention_policy')\"" > /tmp/_drop.sql 2>/dev/null
  su postgres -c "psql -d scada -f /tmp/_drop.sql" >/dev/null 2>&1
}

make_stubs() {
  su postgres -c "psql -d scada" >/dev/null 2>&1 <<'SQL'
CREATE OR REPLACE FUNCTION create_hypertable(relation TEXT, time_column_name TEXT,
       chunk_time_interval INTERVAL DEFAULT NULL, if_not_exists BOOLEAN DEFAULT FALSE)
RETURNS TEXT LANGUAGE sql AS $$ SELECT 'ok'::text $$;
CREATE OR REPLACE FUNCTION add_compression_policy(hypertable regclass, compress_after INTERVAL,
       if_not_exists BOOLEAN DEFAULT FALSE) RETURNS INTEGER LANGUAGE sql AS $$ SELECT 1 $$;
CREATE OR REPLACE FUNCTION add_retention_policy(relation regclass, drop_after INTERVAL,
       if_not_exists BOOLEAN DEFAULT FALSE) RETURNS INTEGER LANGUAGE sql AS $$ SELECT 2 $$;
CREATE OR REPLACE FUNCTION remove_compression_policy(relation regclass,
       if_exists BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT TRUE $$;
CREATE OR REPLACE FUNCTION remove_retention_policy(relation regclass,
       if_exists BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN LANGUAGE sql AS $$ SELECT TRUE $$;
SQL
}

reset_data() {
  su postgres -c "psql -d scada \
    -c 'TRUNCATE niagara.export_state CASCADE' \
    -c 'TRUNCATE niagara.hist_numeric, niagara.hist_boolean, niagara.hist_enum, niagara.hist_string, niagara.point_live, niagara.alarm CASCADE' \
    -c 'TRUNCATE niagara.point CASCADE'" >/dev/null 2>&1
}

run() {
  echo -n "  $1 ... "
  OUT="$(java -cp "$HERE/build/test:$CP" "$1" 2>&1 | grep -v "Picked up")"
  RC=$?

  # Cokme sessizce gecmesin: SONUC satiri yoksa ya da cikis kodu sifir
  # degilse test BASARISIZ sayilir. (Once bu kontrol yoktu ve
  # ArrayIndexOutOfBounds ile coken bir test "gecti" gibi gorunuyordu.)
  if [ "$RC" -ne 0 ] || ! echo "$OUT" | grep -q "SONUC"; then
    echo "COKTU (cikis kodu $RC)"
    echo "$OUT" | tail -15
    FAILED=1
    return
  fi

  echo "$OUT" | grep -E "SONUC" | tail -1
  if echo "$OUT" | grep -q "FAIL"; then
    echo "$OUT" | grep "FAIL"
    FAILED=1
  fi
}

FAILED=0

# Sema ve tablolar yoksa olustur. TsWriterSqlTest ve TsPolicyTest bunlarin
# var oldugunu varsayar; sifirdan bir veritabaninda takim aksi halde
# "schema \"niagara\" does not exist" ile cokuyordu.
echo -n "== hazirlik: sema ... "
make_stubs
java -cp "$HERE/build/test:$CP" TsBootstrap 2>&1 | grep -v "Picked up" | grep -v "^INFO\|baglandi" | tail -1

echo "== 1/3: pgjdbc LazyCleaner yamasi =="
# Bu test kendi SecurityManager'ini kurar (Niagara kisitini taklit eder),
# o yuzden ayri JVM'de ve -Djava.security.manager=allow ile calisir.
echo -n "  TsLazyCleanerTest ... "
LCOUT="$(java -Djava.security.manager=allow -cp "$HERE/build/test:$CP" TsLazyCleanerTest 2>&1 \
         | grep -v "Picked up" | grep -v "terminally deprecated" \
         | grep -v "System::setSecurityManager" | grep -v "Please consider reporting")"
echo "$LCOUT" | grep -E "SONUC" | tail -1
if echo "$LCOUT" | grep -q "FAIL"; then echo "$LCOUT" | grep "FAIL"; FAILED=1; fi

echo "== 2/3: eklenti YOKKEN =="
drop_stubs
run TsNoExtensionTest

echo "== 3/3: eklenti VARMIS gibi (stub) =="
make_stubs
reset_data
run TsPolicyTest
run TsWriterSqlTest
reset_data
run TsHistoryExportTest
reset_data
run TsIntegrationTest

echo
[ "$FAILED" -eq 0 ] && echo "TUM TESTLER GECTI" || echo "BASARISIZ TEST VAR"
exit "$FAILED"
