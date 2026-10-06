// TwinSim Program bileşenini derler: TwinSim.body.java → TwinSim.program.json
//
//   node tools/jace/sim/build.mjs [NIAGARA_HOME]
//
// Niagara'nın kendi JRE'sindeki javac kullanılır (Java 8, baja + program-rt jar'ları).
// Çıktı, istasyona `sim-kur.mjs` ile eklenen Program bileşeninin içeriğidir
// (className, classFile, source…) — Workbench'in Program düzenleyicisinin
// ürettiğiyle aynı alanlar.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NH = process.argv[2] ?? (() => {
  const base = 'C:\\Niagara'
  const v = fs.readdirSync(base).filter((d) => d.startsWith('Niagara-4')).sort().pop()
  if (!v) throw new Error('Niagara kurulumu bulunamadı (C:\\Niagara\\Niagara-4.x)')
  return path.join(base, v)
})()

const body = fs.readFileSync(path.join(HERE, 'TwinSim.body.java'), 'utf8')
const hash = crypto.createHash('sha1').update(body).digest('hex')
const className = 'Prog_' + hash.slice(0, 24)
const imports = ['javax.baja.sys.*', 'javax.baja.status.*', 'javax.baja.naming.*']
const src = `${imports.map((i) => `import ${i};`).join('\n')}

public class ${className} extends com.tridium.program.ProgramBase {
${body}
}
`
const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? HERE, 'twinsim-'))
fs.writeFileSync(path.join(tmp, `${className}.java`), src)
const cp = ['modules/baja.jar', 'modules/program-rt.jar', 'bin/ext/nre.jar'].map((j) => path.join(NH, j)).join(';')
execFileSync(path.join(NH, 'jre', 'bin', 'javac.exe'),
  ['-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8', '-nowarn', '-cp', cp, '-d', tmp, path.join(tmp, `${className}.java`)],
  { stdio: 'inherit' })
const classes = fs.readdirSync(tmp).filter((f) => f.endsWith('.class'))
if (classes.length !== 1) throw new Error(`iç sınıf üretilmemeli (Program tek sınıf yükler): ${classes.join(', ')}`)
const classFile = fs.readFileSync(path.join(tmp, classes[0])).toString('base64')

let checksum = 0
for (const ch of body) checksum = (checksum * 31 + ch.codePointAt(0)) | 0
const out = {
  name: 'TwinSim',
  className,
  classFile,
  dependencies: 'baja;program-rt',
  userDefinedImports: 'baja:javax.baja.naming;baja:javax.baja.status',
  source: body,
  checksum: Math.abs(checksum),
  builtAt: new Date().toISOString(),
  props: [
    { name: 'etkin', type: 'baja:Boolean', value: true },
    { name: 'hizCarpani', type: 'baja:Double', value: 1 },
    { name: 'arizaNasos', type: 'baja:Integer', value: 0 },
    { name: 'arizaTuru', type: 'baja:String', value: '' },
    { name: 'durum', type: 'baja:String', value: '' },
  ],
}
fs.writeFileSync(path.join(HERE, 'TwinSim.program.json'), JSON.stringify(out, null, 2) + '\n')
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`TwinSim.program.json: ${className}, sınıf ${Buffer.from(classFile, 'base64').length} bayt (Niagara: ${NH})`)
