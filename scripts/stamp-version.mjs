import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2026-10-31, owner-reported ("the release number and date are stuck on
// 10/26 ...334") -- this script used to skip stamping entirely on Vercel
// (`git rev-list --count HEAD` needs full history, and Vercel's own
// checkout can be a shallow clone, which would silently return a wrong,
// too-small count there). That meant APP_VERSION only ever updated when
// someone ran `npm run build` locally before pushing -- which this sandbox
// can't do at all (the known SWC-binary limitation) -- so it sat stale for
// 22 commits. Worse than cosmetic: PWAProvider.tsx compares this stamp
// against a live /api/version fetch to prompt "a new version is available,
// reload" -- a stale stamp means both sides always "match," silently
// disabling that check the whole time it was frozen.
//
// Fixed by using Vercel's own injected commit SHA (VERCEL_GIT_COMMIT_SHA,
// always accurate regardless of clone depth -- no git call needed on
// Vercel at all) when present, falling back to local git only when
// building outside Vercel, where full history is always available.
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')

const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA
const buildId = vercelSha
  ? vercelSha.slice(0, 7)
  : execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim()

const versionPath = resolve(projectRoot, 'app/src/version.ts')
const contents = `export const APP_VERSION = '1.03.${buildId}'\nexport const BUILD_DATE = '${new Date().toISOString()}'\n`

mkdirSync(dirname(versionPath), { recursive: true })
writeFileSync(versionPath, contents, 'utf8')
