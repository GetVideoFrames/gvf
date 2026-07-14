#!/usr/bin/env node
/**
 * Basic license allowlist check over package-lock.
 * Fails on unknown/disallowed SPDX when present; skips packages without license metadata.
 * Explicitly does not validate vision/FFmpeg binary assets.
 */
import { readFile, writeFile } from 'node:fs/promises'

const ALLOW = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0'
])

const pkg = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')
)
const packages = pkg.packages ?? {}
const findings = []
const unknown = []

for (const [path, meta] of Object.entries(packages)) {
  if (!path) continue
  if (meta.dev || meta.link || path.startsWith('packages/')) continue
  const license = meta.license
  if (!license) {
    unknown.push({ path, name: meta.name, version: meta.version })
    continue
  }
  const licenses = String(license)
    .split(/\s+OR\s+|\s+AND\s+|\/|\s*,\s*/i)
    .map((s) => s.replace(/[()]/g, '').trim())
    .filter(Boolean)
  const ok = licenses.every((l) => ALLOW.has(l))
  if (!ok) {
    findings.push({ path, name: meta.name, version: meta.version, license })
  }
}

const report = {
  schema: 'gvf.license-report/v1alpha1',
  generatedAt: new Date().toISOString(),
  disclaimer:
    'npm licenses only. Vision text weights remain blocked; FFmpeg is system-provided. See docs/PROVENANCE.md.',
  allowed: [...ALLOW],
  disallowed: findings,
  missingLicenseMetadata: unknown.length,
  ok: findings.length === 0 && unknown.length === 0
}

await writeFile(
  new URL('../license-report.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n'
)

if (findings.length > 0 || unknown.length > 0) {
  console.error('Disallowed licenses found:')
  for (const f of findings) console.error(`  ${f.name}@${f.version}: ${f.license}`)
  for (const item of unknown) {
    console.error(
      `  ${item.name ?? item.path}@${item.version ?? 'unknown'}: missing license`
    )
  }
  process.exit(1)
}

console.log(
  `License check OK (${Object.keys(packages).length - 1} packages scanned; no unknown production licenses).`
)
