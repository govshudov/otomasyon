// TsOkuma Program bileşenini derler: TsOkuma.body.java → TsOkuma.program.json
//
//   node tools/jace/okuma/build.mjs [NIAGARA_HOME]
//
// sim/build.mjs ile aynı yol; sınıf yoluna timescale-rt.jar da eklenir (içindeki PostgreSQL
// JDBC sürücüsü kullanılır, ayrı jar gerekmez). Kurulum: okuma-kur.mjs
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

const body = fs.readFileSync(path.join(HERE, 'TsOkuma.body.java'), 'utf8')
const hash = crypto.createHash('sha1').update(body).digest('hex')
const className = 'Prog_' + hash.slice(0, 24)
const imports = ['javax.baja.sys.*', 'javax.baja.status.*', 'javax.baja.naming.*']
const src = `${imports.map((i) => `import ${i};`).join('\n')}

public class ${className} extends com.tridium.program.ProgramBase {
${body}
}
`
const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? HERE, 'tsokuma-'))
fs.writeFileSync(path.join(tmp, `${className}.java`), src)
// timescale-rt'nin bağımlılıkları yalnız derleme için (BTimescaleDevice → BNDevice …)
const cp = ['baja', 'program-rt', 'timescale-rt', 'ndriver-rt', 'driver-rt', 'control-rt', 'history-rt', 'alarm-rt']
  .map((m) => path.join(NH, 'modules', m + '.jar')).concat(path.join(NH, 'bin/ext/nre.jar')).join(';')
execFileSync(path.join(NH, 'jre', 'bin', 'javac.exe'),
  ['-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8', '-nowarn', '-cp', cp, '-d', tmp, path.join(tmp, `${className}.java`)],
  { stdio: 'inherit' })
const classes = fs.readdirSync(tmp).filter((f) => f.endsWith('.class'))
if (classes.length !== 1) throw new Error(`iç sınıf üretilmemeli (Program tek sınıf yükler): ${classes.join(', ')}`)
const classFile = fs.readFileSync(path.join(tmp, classes[0])).toString('base64')

let checksum = 0
for (const ch of body) checksum = (checksum * 31 + ch.codePointAt(0)) | 0
const out = {
  name: 'TsOkuma',
  className,
  classFile,
  dependencies: 'baja;program-rt;timescale-rt',
  userDefinedImports: 'baja:javax.baja.naming;baja:javax.baja.status',
  source: body,
  checksum: Math.abs(checksum),
  builtAt: new Date().toISOString(),
  props: [
    { name: 'cihaz', type: 'baja:String', value: 'station:|slot:/Drivers/TimescaleNetwork/TimescaleDevice' },
    { name: 'durum', type: 'baja:String', value: '' },
  ],
  actions: [
    { name: 'sorgu', param: 'baja:String', ret: 'baja:String' },
  ],
}
fs.writeFileSync(path.join(HERE, 'TsOkuma.program.json'), JSON.stringify(out, null, 2) + '\n')
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`TsOkuma.program.json: ${className}, sınıf ${Buffer.from(classFile, 'base64').length} bayt (Niagara: ${NH})`)
