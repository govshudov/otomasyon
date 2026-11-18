-- Veritabanında veri var mı, hangi istasyon adıyla, ne zamana kadar? Yalnız okur.
--   psql -h 127.0.0.1 -U postgres -d <veritabanı> -f tools\kurulum\veri-bak.sql
\pset pager off
\echo '== 1. veritabani'
SELECT current_database(), (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb;

\echo '== 2. istasyon adlari ve nokta sayilari (TsOkuma Niagara istasyon adiyla arar)'
SELECT station, count(*) AS nokta, count(*) FILTER (WHERE enabled) AS etkin FROM niagara.point GROUP BY 1 ORDER BY 1;

\echo '== 3. son kayit zamani ve son 1 saatteki kayit sayisi'
SELECT 'numeric' AS tablo, max(time) AS son, count(*) FILTER (WHERE time > now() - interval '1 hour') AS son_1_saat FROM niagara.hist_numeric
UNION ALL SELECT 'boolean', max(time), count(*) FILTER (WHERE time > now() - interval '1 hour') FROM niagara.hist_boolean;

\echo '== 4. istasyon basina son kayit'
SELECT p.station, max(h.time) AS son, count(*) AS kayit FROM niagara.hist_numeric h JOIN niagara.point p USING (point_id) GROUP BY 1 ORDER BY 1;

\echo '== 5. sayac noktalari (_Akym / _Toplam / _Jemi) ve son kayitlari'
SELECT p.station, p.name, p.value_type, max(h.time) AS son, count(h.*) AS kayit
FROM niagara.point p LEFT JOIN niagara.hist_numeric h USING (point_id)
WHERE p.name ~* '(_Akym|_Toplam|_Jemi)$'
GROUP BY 1, 2, 3 ORDER BY 1, 2 LIMIT 80;

\echo '== 6. ornek nokta adlari (ilk 40)'
SELECT station, name, value_type FROM niagara.point ORDER BY station, name LIMIT 40;

\echo '== 7. saatlik / gunluk ozetler'
SELECT 'hist_numeric_1h' AS ozet, count(*), max(bucket) FROM niagara.hist_numeric_1h
UNION ALL SELECT 'hist_numeric_1d', count(*), max(bucket) FROM niagara.hist_numeric_1d;
