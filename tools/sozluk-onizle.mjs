// Sözlük önizlemesi: veritabanındaki nokta adlarını common/sozluk.json ile çevirip listeler.
//
//   $env:PGPASSWORD = "<şifre>"
//   node tools/sozluk-onizle.mjs [İSTASYON] [--csv cikti.csv]
//
// İstasyon verilmezse veritabanındaki tüm istasyonlar. CSV (Excel, ; ayraçlı) incelemek için:
// yanlış çıkan satırın görünen adı common/sozluk.json → "duzeltmeler"e yazılır.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { etiket } from '../web/src/data/etiket.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const soz = JSON.parse(fs.readFileSync(path.join(ROOT, 'common/sozluk.json'), 'utf8'))
const args = process.argv.slice(2)
const ci = args.indexOf('--csv')
const csv = ci >= 0 ? args.splice(ci, 2)[1] : null
const station = args[0] ?? null

const psql = (() => {
  const base = 'C:\\Program Files\\PostgreSQL'
  const v = fs.existsSync(base) ? fs.readdirSync(base).sort((a, b) => Number(b) - Number(a))[0] : null
  return v ? path.join(base, v, 'bin', 'psql.exe') : 'psql'
})()
const where = station ? `WHERE station = '${station.replace(/'/g, "''")}'` : ''
const out = execFileSync(psql, ['-h', 'localhost', '-U', 'postgres', '-d', 'Niagara', '-At', '-F', '\t', '-c',
  `SELECT DISTINCT station, name FROM niagara.point ${where} ORDER BY 1, 2`], { encoding: 'utf8' })
const rows = out.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'))
  .filter(([, n]) => !/^(Audit|Log|Security)History$/.test(n) && !n.startsWith('TWIN_'))

const res = rows.map(([st, n]) => [st, n, etiket(n, soz)])
const w = Math.max(...res.map((r) => r[1].length))
for (const [st, n, l] of res) console.log(`${station ? '' : st + '  '}${n.padEnd(w)}  →  ${l}`)
console.log(`${res.length} ad (TWIN_ noktaları katalogdan adlanır, burada yok)`)
if (csv) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`
  fs.writeFileSync(csv, '\ufeff' + [['İstasyon', 'Ad', 'Görünen ad'], ...res].map((r) => r.map(q).join(';')).join('\r\n'))
  console.log('CSV:', csv)
}
