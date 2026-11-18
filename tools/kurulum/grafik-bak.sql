-- Grafiğin TsOkuma'ya yaptırdığı sorgunun aynısı (TsOkuma.body.java hist(), ham veri dalı), son 2 saat.
-- Yalnız okur.
--   psql -h 127.0.0.1 -U postgres -d Niagara -f tools\kurulum\grafik-bak.sql
\pset pager off
\set st '''BIRINJI_MAY'''
\set nm '''{Toplum_1_Temps_P1_W2,Toplum_1_Temps_P1_U1}'''

\echo '== 1. ham kayitlar (son 2 saat)'
SELECT v.name, h.time, h.value, h.status
FROM niagara.hist_numeric h JOIN niagara.v_point v USING (point_id)
WHERE v.station = :st AND v.name = ANY(:nm::text[]) AND h.time >= now() - interval '2 hours'
ORDER BY 1, 2;

\echo '== 2. grafigin sorgusu (kovalar)'
SELECT name, to_timestamp(extract(epoch from b)) AS kova, a, mn, mx FROM (
  SELECT v.name, time_bucket(make_interval(secs => 30), h.time) b, avg(h.value) a, min(h.value) mn, max(h.value) mx
  FROM niagara.hist_numeric h JOIN niagara.v_point v USING (point_id)
  WHERE v.station = :st AND v.name = ANY(:nm::text[]) AND h.time >= now() - interval '2 hours' AND h.time < now()
    AND h.value = h.value GROUP BY 1, 2
  UNION ALL
  SELECT v.name, (now() - interval '2 hours') - make_interval(secs => 15) b, x.value a, x.value mn, x.value mx
  FROM niagara.v_point v CROSS JOIN LATERAL (SELECT value FROM niagara.hist_numeric h
    WHERE h.point_id = v.point_id AND h.time < now() - interval '2 hours' AND h.value = h.value ORDER BY h.time DESC LIMIT 1) x
  WHERE v.station = :st AND v.name = ANY(:nm::text[])
) x ORDER BY 1, 2;

\echo '== 3. ayni ad birden cok nokta mi? (v_point satir sayisi)'
SELECT name, count(*) AS satir, array_agg(point_id) AS point_id, array_agg(value_type) AS tur
FROM niagara.v_point WHERE station = :st AND name = ANY(:nm::text[]) GROUP BY 1;
