// timescale-rt.jar derlemesi (Windows, build.sh ile aynı adımlar):
//
//   node driver/timescale/build.mjs [NIAGARA_HOME]
//
// Niagara'nın kendi JDK 8'i kullanılır (jre\bin\javac.exe; jar aracı jre\lib\tools.jar içinde).
// Çıktı: driver/timescale/build/timescale-rt.jar — İMZASIZ. İmza: imzala.ps1 (şifreyi sorar).
// Sıra önemli (bkz. build.sh): pgjdbc önce açılır, kendi sınıflarımız üstüne kopyalanır;
// org/postgresql/util/LazyCleaner yaması böyle pgjdbc'nin sınıfını ezer. Uygulandığı doğrulanır.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NH = process.argv[2] ?? (() => {
  const base = 'C:\\Niagara'
  const v = fs.readdirSync(base).filter((d) => d.startsWith('Niagara-4')).sort().pop()
  if (!v) throw new Error('Niagara kurulumu bulunamadı (C:\\Niagara\\Niagara-4.x)')
  return path.join(base, v)
})()

const VERSION = /^VENDOR_VERSION="([^"]+)"/m.exec(fs.readFileSync(path.join(HERE, 'build.sh'), 'utf8'))[1]
const MODULE = 'timescale', PROFILE = 'rt', SYMBOL = 'ts', VENDOR = 'Akyllyoy', NDEP = '4.15'
const DESCRIPTION = 'Niagara to TimescaleDB history / point / alarm export driver'

const SRC = path.join(HERE, 'timescale', 'timescale-rt', 'src')
const OUT = path.join(HERE, 'build')
const CLASSES = path.join(OUT, 'classes'), STAGE = path.join(OUT, 'stage')
const JAR = path.join(OUT, `${MODULE}-${PROFILE}.jar`)
const PGJDBC = path.join(HERE, 'lib', 'postgresql-42.7.2.jar')
const JAVA = path.join(NH, 'jre', 'bin', 'java.exe'), JAVAC = path.join(NH, 'jre', 'bin', 'javac.exe')
const TOOLS = path.join(NH, 'jre', 'lib', 'tools.jar')
const jarTool = (args, cwd) => execFileSync(JAVA, ['-cp', TOOLS, 'sun.tools.jar.Main', ...args], { cwd, stdio: 'inherit' })

const CP = [path.join(NH, 'bin', 'ext', 'nre.jar'),
  ...['baja', 'driver-rt', 'ndriver-rt', 'history-rt', 'alarm-rt', 'control-rt', 'bql-rt'].map((m) => path.join(NH, 'modules', m + '.jar'))]
for (const f of [JAVAC, TOOLS, PGJDBC, ...CP]) if (!fs.existsSync(f)) throw new Error('bulunamadı: ' + f)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(CLASSES, { recursive: true }); fs.mkdirSync(path.join(STAGE, 'META-INF'), { recursive: true })

console.log(`==> javac (Java 8, ${path.basename(NH)})`)
const sources = []
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.java')) sources.push(p) } }
walk(SRC)
fs.writeFileSync(path.join(OUT, 'sources.txt'), sources.map((s) => `"${s.replace(/\\/g, '/')}"`).join('\n'))
execFileSync(JAVAC, ['-source', '1.8', '-target', '1.8', '-nowarn', '-proc:none', '-encoding', 'UTF-8',
  '-d', CLASSES, '-cp', CP.join(';'), '@' + path.join(OUT, 'sources.txt')], { stdio: 'inherit' })

console.log('==> pgjdbc gömülüyor:', path.basename(PGJDBC))
jarTool(['xf', PGJDBC], STAGE)
const meta = path.join(STAGE, 'META-INF')
for (const f of fs.readdirSync(meta)) if (/\.(SF|RSA|DSA|EC)$/i.test(f) || f === 'MANIFEST.MF') fs.rmSync(path.join(meta, f))
fs.rmSync(path.join(meta, 'maven'), { recursive: true, force: true })

console.log('==> sınıflar kopyalanıyor (pgjdbc üzerine)')
fs.cpSync(CLASSES, STAGE, { recursive: true })
const lc = 'org/postgresql/util/LazyCleaner.class'
if (!fs.readFileSync(path.join(CLASSES, lc)).equals(fs.readFileSync(path.join(STAGE, lc)))) throw new Error('LazyCleaner yaması UYGULANMADI')
console.log('    LazyCleaner yaması uygulandı')

console.log('==> kaynak dosyalar')
fs.copyFileSync(path.join(HERE, 'timescale', 'timescale-rt', 'module.palette'), path.join(STAGE, 'module.palette'))
fs.copyFileSync(path.join(HERE, 'timescale', 'timescale-rt', 'module.lexicon'), path.join(STAGE, `${MODULE}-${PROFILE}.lexicon`))

console.log('==> META-INF/module.xml')
const deps = ['alarm-rt', 'baja', 'control-rt', 'driver-rt', 'history-rt', 'ndriver-rt']
fs.writeFileSync(path.join(meta, 'module.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<module name="${MODULE}-${PROFILE}" bajaVersion="0" vendor="${VENDOR}" vendorVersion="${VERSION}" description="${DESCRIPTION}" preferredSymbol="${SYMBOL}" nre="true" autoload="true" installable="true" buildMillis="${Date.now()}" buildHost="otomasyon" moduleName="${MODULE}" runtimeProfile="${PROFILE}">
 <dependencies>
${deps.map((d) => `  <dependency name="${d}" vendor="Tridium" vendorVersion="${NDEP}"/>`).join('\n')}
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
`)

console.log('==> jar')
fs.writeFileSync(path.join(OUT, 'manifest.txt'), `Manifest-Version: 1.0\nImplementation-Version: ${VERSION}\nImplementation-Vendor: ${VENDOR}\n`)
jarTool(['cfm', JAR, path.join(OUT, 'manifest.txt'), '-C', STAGE, '.'], OUT)

let n = 0
const count = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) count(p); else if (f.endsWith('.class')) n++ } }
count(CLASSES)
console.log(`\nTAMAM: ${JAR}\n  sürüm    : ${VERSION}\n  boyut    : ${(fs.statSync(JAR).size / 1024).toFixed(0)} KB\n  sınıflar : ${n}\n  İMZASIZ  → imzala.ps1`)
