/**
 * E2E vertical slice: generate temp video with system FFmpeg → probe → extract → analyze → select → export.
 * Skips clearly when FFmpeg is unavailable.
 */

import { describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  inspectRuntime,
  probeVideo,
  extractFrames,
  extractFramesBatch,
  analyzeFrames,
  selectFrames,
  exportFrames,
  canonicalSourcePath,
  readFrameRecords,
  readManifest,
  runPipelineBatch
} from '@gvf/core'

function hasFfmpeg(): boolean {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  return r.status === 0
}

describe('E2E vertical slice', () => {
  it('runs local video → probe → candidates → analyze → select → HQ export', async (ctx) => {
    if (!hasFfmpeg()) {
      ctx.skip()
      return
    }

    const status = await inspectRuntime()
    if (!status.ffmpeg.ok) {
      ctx.skip()
      return
    }

    const dir = await mkdtemp(join(tmpdir(), 'gvf-e2e-'))
    const video = join(dir, 'sample.mp4')
    const gen = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=10:duration=2',
        '-pix_fmt',
        'yuv420p',
        video
      ],
      { encoding: 'utf8' }
    )
    if (gen.status !== 0) {
      ctx.skip()
      return
    }

    try {
      const relativeVideo = relative(process.cwd(), video)
      const probe = await probeVideo(relativeVideo)
      expect(probe.durationSec).toBeGreaterThan(1)
      expect(probe.width).toBe(320)
      expect(probe.path).toBe(canonicalSourcePath(video))

      const extracted = await extractFrames(relativeVideo, {
        every: 0.5,
        candidates: true,
        workspace: join(dir, 'workspace'),
        budget: 20
      })
      expect(extracted.frames).toHaveLength(4)
      expect(extracted.sampling.strategy).toBe('every')
      expect(extracted.sampling.count).toBe(4)
      expect((await readManifest(extracted.workspace!)).candidateMaxWidth).toBe(640)
      expect((await readManifest(extracted.workspace!)).source.path).toBe(
        canonicalSourcePath(video)
      )

      const autoSelected = await selectFrames(relativeVideo, {
        workspace: extracted.workspace,
        detect: false,
        limit: 2
      })
      expect(autoSelected.selections.sourcePath).toBe(canonicalSourcePath(video))
      expect(
        (await readFrameRecords(extracted.workspace!))[0]?.metrics?.composite
      ).toBeTypeOf('number')

      const originalCwd = process.cwd()
      try {
        process.chdir(dir)
        const cwdIndependentExport = await exportFrames('sample.mp4', {
          selection: autoSelected.selectionsPath,
          output: join(dir, 'cwd-independent-export'),
          workspace: autoSelected.workspace
        })
        expect(cwdIndependentExport.exported.length).toBeGreaterThan(0)
      } finally {
        process.chdir(originalCwd)
      }

      const all = await extractFrames(video, {
        all: true,
        force: true,
        candidates: false,
        output: join(dir, 'all-frames')
      })
      expect(all.frames).toHaveLength(20)
      expect(all.sampling.count).toBe(20)
      expect(all.sampling.timestampBasis).toBe('source-pts')
      await access(all.manifestPath)
      expect(JSON.parse(await readFile(all.manifestPath, 'utf8')).schema).toBe(
        'gvf.extract-manifest/v1alpha1'
      )
      expect((await readFile(all.framesPath, 'utf8')).trim().split('\n')).toHaveLength(20)

      const candidateAll = await extractFrames(video, {
        all: true,
        force: true,
        candidates: true,
        workspace: join(dir, 'workspace-all'),
        budget: 30
      })
      expect(candidateAll.sampling.timestampBasis).toBe('source-pts')
      expect(candidateAll.sampling.capped).toBe(false)

      const guarded = join(dir, 'guarded')
      await mkdir(guarded)
      await writeFile(join(guarded, 'sentinel.txt'), 'keep')
      await writeFile(join(guarded, 'frame_000001.jpg'), 'old')
      await expect(
        extractFrames(video, {
          count: 1,
          candidates: false,
          output: guarded
        })
      ).rejects.toMatchObject({ code: 'GUARD' })
      await extractFrames(video, {
        count: 1,
        candidates: false,
        output: guarded,
        overwrite: true
      })
      expect(await readFile(join(guarded, 'sentinel.txt'), 'utf8')).toBe('keep')

      const batch = await extractFramesBatch([video, video], {
        count: 1,
        candidates: false,
        output: join(dir, 'batch')
      })
      expect(batch.data.map((item) => item.outputDir)).toEqual([
        join(dir, 'batch', 'sample'),
        join(dir, 'batch', 'sample-2')
      ])

      const analyzed = await analyzeFrames(video, {
        workspace: extracted.workspace
      })
      expect(analyzed.summary.sampledCount).toBe(extracted.frames.length)
      expect(analyzed.frames[0]?.metrics?.composite).toBeTypeOf('number')

      const selected = await selectFrames(video, {
        workspace: analyzed.workspace,
        rank: 'sharpness',
        dedupe: true,
        bestPerScene: 1,
        limit: 3,
        detect: false,
        analyze: false
      })
      expect(selected.selections.selections.length).toBeGreaterThan(0)

      const out = join(dir, 'export')
      const exported = await exportFrames(video, {
        selection: selected.selectionsPath,
        output: out,
        workspace: selected.workspace,
        format: 'image/jpeg',
        quality: 0.9
      })
      expect(exported.exported.length).toBe(selected.selections.selections.length)
      expect(exported.manifestPath).toBeTruthy()
      await writeFile(join(out, 'sentinel.txt'), 'keep')
      await expect(
        exportFrames(video, {
          selection: selected.selectionsPath,
          output: out,
          workspace: selected.workspace
        })
      ).rejects.toMatchObject({ code: 'GUARD' })
      await exportFrames(video, {
        selection: selected.selectionsPath,
        output: out,
        workspace: selected.workspace,
        overwrite: true
      })
      expect(await readFile(join(out, 'sentinel.txt'), 'utf8')).toBe('keep')

      const batchRun = await runPipelineBatch([video, video], {
        count: 1,
        export: join(dir, 'run-batch'),
        limit: 1,
        concurrency: 2
      })
      expect(batchRun.data.map((item) => item.export?.outputDir)).toEqual([
        join(dir, 'run-batch', 'sample'),
        join(dir, 'run-batch', 'sample-2')
      ])
      await access(join(dir, 'run-batch', 'sample', 'manifest.json'))
      await access(join(dir, 'run-batch', 'sample-2', 'manifest.json'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('maps VFR all-frame records to exact source PTS', async (ctx) => {
    if (!hasFfmpeg()) {
      ctx.skip()
      return
    }
    const dir = await mkdtemp(join(tmpdir(), 'gvf-vfr-e2e-'))
    const video = join(dir, 'vfr.mp4')
    try {
      const generated = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=160x120:rate=5:duration=1',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=160x120:rate=15:duration=1',
          '-filter_complex',
          '[0:v][1:v]concat=n=2:v=1:a=0[v]',
          '-map',
          '[v]',
          '-fps_mode',
          'vfr',
          '-pix_fmt',
          'yuv420p',
          video
        ],
        { encoding: 'utf8' }
      )
      expect(generated.status, generated.stderr).toBe(0)

      const direct = await extractFrames(video, {
        all: true,
        force: true,
        candidates: false,
        output: join(dir, 'direct')
      })
      expect(direct.sampling.timestampBasis).toBe('source-pts')
      const intervals = new Set(
        direct.frames
          .slice(1)
          .map((frame, index) =>
            Number((frame.timeSec - direct.frames[index]!.timeSec).toFixed(3))
          )
      )
      expect(intervals.size).toBeGreaterThan(1)

      const candidates = await extractFrames(video, {
        all: true,
        force: true,
        candidates: true,
        workspace: join(dir, 'workspace'),
        budget: 100
      })
      expect(candidates.sampling.timestampBasis).toBe('source-pts')
      expect(candidates.frames.map((frame) => frame.timeSec)).toEqual(
        direct.frames.map((frame) => frame.timeSec)
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
