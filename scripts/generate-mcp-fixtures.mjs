#!/usr/bin/env node
/**
 * Deterministic local MCP evaluation fixtures.
 * Inputs are FFmpeg lavfi sources only; generated media lives under ignored tmp/.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const outputDir = resolve(process.argv[2] ?? 'tmp/mcp-eval')
const ffmpeg = process.env.GVF_FFMPEG_PATH?.trim() || 'ffmpeg'
const escapedOutputDir = outputDir
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const fixtures = [
  {
    name: 'landscape-2s-10fps.mp4',
    args: [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=10:duration=2',
      '-an',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5'
    ]
  },
  {
    name: 'portrait-3s-12fps.mp4',
    args: [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=180x320:rate=12:duration=3',
      '-an',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5'
    ]
  },
  {
    name: 'square-audio-1.5s-8fps.mp4',
    args: [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=240x240:rate=8:duration=1.5',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=1.5',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-c:a',
      'aac',
      '-shortest'
    ]
  },
  {
    name: 'wide-1s-15fps.mp4',
    args: [
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:size=640x360:rate=15:duration=1',
      '-an',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5'
    ]
  }
]

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

for (const fixture of fixtures) {
  const output = join(outputDir, fixture.name)
  const result = spawnSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-y', ...fixture.args, output],
    {
      encoding: 'utf8',
      shell: false
    }
  )
  if (result.status !== 0) {
    console.error(result.stderr || `FFmpeg failed for ${fixture.name}`)
    process.exit(result.status ?? 1)
  }
}

const evalTemplate = await readFile(
  new URL('../docs/mcp-evals.xml', import.meta.url),
  'utf8'
)
const resolvedEvalsPath = join(outputDir, 'mcp-evals.resolved.xml')
await writeFile(
  resolvedEvalsPath,
  evalTemplate.replaceAll('{{FIXTURES_DIR}}', escapedOutputDir),
  'utf8'
)

process.stdout.write(
  JSON.stringify(
    {
      schema: 'gvf.mcp-fixtures/v1alpha1',
      outputDir,
      fixtures: fixtures.map((fixture) => join(outputDir, fixture.name)),
      resolvedEvalsPath
    },
    null,
    2
  ) + '\n'
)
