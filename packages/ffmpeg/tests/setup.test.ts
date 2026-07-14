import { describe, expect, it } from 'vitest'
import {
  buildFfmpegSetupPlan,
  ffmpegResolutionOrder,
  loadSidecarManifest,
  setupFfmpeg,
  FfmpegSetupBlockedError
} from '@gvf/ffmpeg'

describe('ffmpeg sidecar setup', () => {
  it('prefers system PATH before managed fallback', () => {
    expect(ffmpegResolutionOrder()).toEqual(['path', 'managed'])
    expect(ffmpegResolutionOrder({ env: true })).toEqual(['env', 'path', 'managed'])
    expect(ffmpegResolutionOrder({ explicit: true, env: true })).toEqual([
      'explicit',
      'env',
      'path',
      'managed'
    ])
  })

  it('loads manifest with blocked platform entries', async () => {
    const manifest = await loadSidecarManifest()
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.binaries.every((b) => b.status === 'blocked')).toBe(true)
    const plan = buildFfmpegSetupPlan(manifest)
    expect(plan.schema).toBe('gvf.ffmpeg-setup-plan/v1alpha1')
    expect(plan.systemGuidance.length).toBeGreaterThan(10)
  })

  it('refuses to download while provenance is blocked', async () => {
    await expect(setupFfmpeg({ yes: true })).rejects.toBeInstanceOf(
      FfmpegSetupBlockedError
    )
  })
})
