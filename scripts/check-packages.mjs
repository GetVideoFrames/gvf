#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const workspaces = ['core', 'cli', 'mcp', 'ffmpeg', 'vision']
for (const workspace of workspaces) {
  const cwd = new URL(`../packages/${workspace}/`, import.meta.url)
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd,
    encoding: 'utf8',
    shell: false
  })
  if (result.status !== 0)
    throw new Error(result.stderr || `npm pack failed: ${workspace}`)
  const report = JSON.parse(result.stdout)[0]
  const files = report.files.map((file) => file.path)
  for (const required of ['LICENSE', 'README.md', 'package.json']) {
    if (!files.includes(required)) {
      throw new Error(`${workspace} package is missing ${required}`)
    }
  }
  if (workspace === 'vision' && !files.includes('THIRD_PARTY_NOTICE.md')) {
    throw new Error('vision package is missing THIRD_PARTY_NOTICE.md')
  }
  if (workspace === 'ffmpeg' && !files.includes('sidecar-manifest.json')) {
    throw new Error('ffmpeg package is missing sidecar-manifest.json')
  }
  if (workspace === 'vision' && !files.includes('model-manifest.json')) {
    throw new Error('vision package is missing model-manifest.json')
  }
  const forbidden = files.filter(
    (file) =>
      /\.(?:onnx|bin)$/i.test(file) || /(?:^|\/)(?:ffmpeg|ffprobe)(?:\.exe)?$/i.test(file)
  )
  if (forbidden.length > 0) {
    throw new Error(
      `${workspace} package contains forbidden assets: ${forbidden.join(', ')}`
    )
  }
  console.log(
    `${workspace}: ${files.length} files; legal files present; no binary assets`
  )
}
