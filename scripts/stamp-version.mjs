import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.VERCEL) {
  process.exit(0)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const commitCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim()
const versionPath = resolve(projectRoot, 'app/src/version.ts')
const contents = `export const APP_VERSION = '1.03.${commitCount}'\nexport const BUILD_DATE = '${new Date().toISOString()}'\n`

mkdirSync(dirname(versionPath), { recursive: true })
writeFileSync(versionPath, contents, 'utf8')
