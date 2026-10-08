-- =====================================================================
--  Okuma katmanı: ad tablosu, adlı görünümler, saatlik/günlük özetler.
--  timescale-rt sürücüsünün şemasının (niagara.point, niagara.hist_*) ÜSTÜNE kurulur;
--  sürücünün yazdığı tablolara dokunmaz. Tekrar çalıştırmak güvenlidir.
--
--    psql -h localhost -U postgres -d Niagara -f db/timescale/10_okuma.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ad tablosu: teknik ad (history adı) → ekranda/raporda görünen ad
--    Kaynak: 'kural' (sözlükle üretildi) ya da 'elle' (Excel'den düzeltildi).
--    Elle düzeltilen satırlar kural yeniden çalışınca ezilmez.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS niagara.point_label (
    station     TEXT NOT NULL,                 -- Niagara istasyon adı (örn. MAGTYMGULY)
    name        TEXT NOT NULL,                 -- history adı, örn. BA4_G9_Toplam
    label       TEXT NOT NULL,                 -- görünen ad, örn. Beton akaba 4 · Gatla 9 · jemi
    grp         TEXT,                          -- grup (rapor/grafik listesinde başlık)
    unit        TEXT,                          -- birim
    sort        INTEGER,
    source      TEXT NOT NULL DEFAULT 'kural' CHECK (source IN ('kural', 'elle')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (station, name)
);

-- Noktalar adlarıyla: ad tablosunda yoksa teknik ad gösterilir.
-- station = Niagara istasyon adı. Her istasyon sabit adla kurulur (MAGTYMGULY gibi); ad aynı
-- kaldıkça yeni sürüm istasyon aynı noktalara kaldığı yerden yazar.
DROP VIEW IF EXISTS niagara.v_export_health, niagara.v_live, niagara.v_enum, niagara.v_boolean, niagara.v_numeric, niagara.v_point;
CREATE VIEW niagara.v_point AS
SELECT p.point_id, p.station, p.name, p.value_type, p.interval_ms, p.source_ord, p.enabled,
       COALESCE(l.label, p.display_name, p.name) AS label,
       COALESCE(l.grp, split_part(p.name, '_', 1)) AS grp,
       COALESCE(l.unit, p.unit) AS unit,
       l.sort, l.source AS label_source
FROM   niagara.point p
LEFT   JOIN niagara.point_label l ON l.station = p.station AND l.name = p.name;

-- ---------------------------------------------------------------------
-- 2) Adlı okuma görünümleri (Grafana / el sorguları)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW niagara.v_numeric AS
SELECT h.time, h.value, h.status, v.point_id, v.station, v.name, v.label, v.grp, v.unit
FROM   niagara.hist_numeric h JOIN niagara.v_point v USING (point_id);

CREATE OR REPLACE VIEW niagara.v_boolean AS
SELECT h.time, h.value, h.status, v.point_id, v.station, v.name, v.label, v.grp
FROM   niagara.hist_boolean h JOIN niagara.v_point v USING (point_id);

CREATE OR REPLACE VIEW niagara.v_enum AS
SELECT h.time, h.value AS ordinal, h.status, v.point_id, v.station, v.name, v.label, v.grp
FROM   niagara.hist_enum h JOIN niagara.v_point v USING (point_id);

CREATE OR REPLACE VIEW niagara.v_live AS
SELECT l.time, l.num_value, l.bool_value, l.str_value, l.enum_value, l.status,
       v.point_id, v.station, v.name, v.label, v.grp, v.unit, v.value_type,
       now() - l.time AS staleness
FROM   niagara.point_live l JOIN niagara.v_point v USING (point_id);

-- Aktarım sağlığı: hangi nokta ne kadar geride
CREATE OR REPLACE VIEW niagara.v_export_health AS
SELECT v.point_id, v.station, v.name, v.label, v.interval_ms,
       e.last_time, e.last_run, e.last_status, e.rows_total, now() - e.last_time AS lag,
       CASE WHEN e.last_time IS NULL THEN 'never'
            WHEN v.interval_ms IS NULL THEN 'unknown'
            WHEN now() - e.last_time > make_interval(secs => (v.interval_ms / 1000.0) * 3) THEN 'stale'
            ELSE 'ok' END AS health
FROM   niagara.v_point v LEFT JOIN niagara.export_state e USING (point_id)
WHERE  v.enabled;

-- ---------------------------------------------------------------------
-- 3) Özetler (continuous aggregate). Uzun aralıklı grafikler bunlardan okur.
--    Saatlik: ham veriden. Günlük: saatlikten (toplam/adet ile doğru ortalama).
--    Ham veri 5 yıl tutulur; özetler 10 yıl (uzun dönem eğilim kaybolmasın).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.continuous_aggregates
                 WHERE view_schema = 'niagara' AND view_name = 'hist_numeric_1h') THEN
    EXECUTE $q$
      CREATE MATERIALIZED VIEW niagara.hist_numeric_1h WITH (timescaledb.continuous) AS
      SELECT time_bucket(INTERVAL '1 hour', time) AS bucket, point_id,
             sum(value) AS s, count(*) AS n, min(value) AS mn, max(value) AS mx, last(value, time) AS last
      FROM   niagara.hist_numeric
      GROUP  BY 1, 2
      WITH NO DATA $q$;
    PERFORM add_continuous_aggregate_policy('niagara.hist_numeric_1h',
      start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes');
    PERFORM add_retention_policy('niagara.hist_numeric_1h', INTERVAL '10 years');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.continuous_aggregates
                 WHERE view_schema = 'niagara' AND view_name = 'hist_numeric_1d') THEN
    EXECUTE $q$
      CREATE MATERIALIZED VIEW niagara.hist_numeric_1d WITH (timescaledb.continuous) AS
      SELECT time_bucket(INTERVAL '1 day', bucket) AS bucket, point_id,
             sum(s) AS s, sum(n) AS n, min(mn) AS mn, max(mx) AS mx, last(last, bucket) AS last
      FROM   niagara.hist_numeric_1h
      GROUP  BY 1, 2
      WITH NO DATA $q$;
    PERFORM add_continuous_aggregate_policy('niagara.hist_numeric_1d',
      start_offset => INTERVAL '60 days', end_offset => INTERVAL '1 day', schedule_interval => INTERVAL '1 hour');
    PERFORM add_retention_policy('niagara.hist_numeric_1d', INTERVAL '10 years');
  END IF;

  -- Açık/kapalı noktalar: saatlik "açık oranı" (0..1) ve son değer
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.continuous_aggregates
                 WHERE view_schema = 'niagara' AND view_name = 'hist_boolean_1h') THEN
    EXECUTE $q$
      CREATE MATERIALIZED VIEW niagara.hist_boolean_1h WITH (timescaledb.continuous) AS
      SELECT time_bucket(INTERVAL '1 hour', time) AS bucket, point_id,
             avg(value::int) AS on_ratio, count(*) AS n, last(value, time) AS last
      FROM   niagara.hist_boolean
      GROUP  BY 1, 2
      WITH NO DATA $q$;
    PERFORM add_continuous_aggregate_policy('niagara.hist_boolean_1h',
      start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes');
    PERFORM add_retention_policy('niagara.hist_boolean_1h', INTERVAL '10 years');
  END IF;
END $$;

-- Gerçek zamanlı özet: henüz özetlenmemiş son saat(ler) ham veriden tamamlanır
ALTER MATERIALIZED VIEW niagara.hist_numeric_1h SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW niagara.hist_numeric_1d SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW niagara.hist_boolean_1h SET (timescaledb.materialized_only = false);

-- İlk doldurma (eski veri için bir kez; sonrası politikayla kendiliğinden):
--   CALL refresh_continuous_aggregate('niagara.hist_numeric_1h', NULL, now() - INTERVAL '1 hour');
--   CALL refresh_continuous_aggregate('niagara.hist_numeric_1d', NULL, now() - INTERVAL '1 day');
--   CALL refresh_continuous_aggregate('niagara.hist_boolean_1h', NULL, now() - INTERVAL '1 hour');
