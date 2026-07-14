import { describe, expect, it } from 'vitest'
import {
  analyzeSmartFrames,
  pickParetoBestFrameIds,
  pickSceneChangeFrameIds,
  adaptiveSceneThreshold,
  renderFrameFilename,
  renderUniqueFrameFilenames,
  buildSamplingPlan,
  planTimestamps,
  filterFrames,
  buildSelectionsFile,
  applyPreset,
  selectFrames,
  prepareOutputDirectory,
  sourceSubdirectories,
  exportFrames,
  atomicWriteJson,
  canReuseDetections,
  createWorkspace,
  inspectRuntime,
  readFrameRecords,
  writeFrameRecords,
  readManifest,
  GvfError,
  SCHEMA_FRAME,
  type SmartFrameInput,
  type FrameRecord
} from '@gvf/core'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function solidFrame(
  id: string,
  timeMs: number,
  rgb: [number, number, number]
): SmartFrameInput {
  const width = 16
  const height = 16
  const data = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = rgb[0]
    data[i * 3 + 1] = rgb[1]
    data[i * 3 + 2] = rgb[2]
  }
  return { id, timeMs, pixels: { data, width, height, channels: 3 } }
}

describe('smart analysis', () => {
  it('detects scene change and recommends frames', () => {
    const frames = [
      solidFrame('a', 0, [10, 10, 10]),
      solidFrame('b', 500, [12, 12, 12]),
      solidFrame('c', 2000, [200, 200, 200]),
      solidFrame('d', 2500, [198, 198, 198])
    ]
    const result = analyzeSmartFrames(frames, {
      minRecommendations: 1,
      maxRecommendations: 4,
      scene: { sensitivity: 0.9, debounceMs: 100 }
    })
    expect(result.sampledCount).toBe(4)
    expect(result.recommendedIds.length).toBeGreaterThan(0)
  })

  it('adapts scene threshold to motion profile', () => {
    const low = adaptiveSceneThreshold([0.01, 0.02, 0.015, 0.012], 0.58)
    const high = adaptiveSceneThreshold([0.2, 0.25, 0.22, 0.8], 0.58)
    expect(high).toBeGreaterThan(low)
  })
})

describe('selection helpers', () => {
  it('picks Pareto keepers', () => {
    const ids = pickParetoBestFrameIds([
      { id: 'a', timeMs: 0, compositeScore: 0.9, sharpnessScore: 0.9 },
      { id: 'b', timeMs: 100, compositeScore: 0.88, sharpnessScore: 0.4 },
      {
        id: 'e',
        timeMs: 400,
        compositeScore: 0.91,
        sharpnessScore: 0.91,
        duplicateOfId: 'a'
      }
    ])
    expect(ids).toContain('a')
    expect(ids).not.toContain('e')
  })

  it('picks one frame per scene', () => {
    expect(
      pickSceneChangeFrameIds([
        { id: 's0-weak', timeMs: 0, sceneIndex: 0, compositeScore: 0.4 },
        { id: 's0-best', timeMs: 100, sceneIndex: 0, compositeScore: 0.8 },
        { id: 's1-best', timeMs: 500, sceneIndex: 1, compositeScore: 0.7 }
      ])
    ).toEqual(['s0-best', 's1-best'])
  })
})

describe('naming', () => {
  it('renders templates and unique names', () => {
    expect(
      renderFrameFilename('{source}_{index}_{time}', {
        sourceStem: 'clip',
        index: 1,
        timeMs: 1250
      })
    ).toContain('clip_0001')
    const names = renderUniqueFrameFilenames('{source}', [
      { sourceStem: 'a', index: 1, timeMs: 0 },
      { sourceStem: 'a', index: 2, timeMs: 100 }
    ])
    expect(names[0]).toBe('a')
    expect(names[1]).toBe('a_2')
  })
})

describe('sampling budget', () => {
  it('caps and never claims equal density when capped', () => {
    const plan = buildSamplingPlan({
      every: 0.5,
      durationSec: 10_000,
      budget: 100
    })
    expect(plan.capped).toBe(true)
    expect(plan.equalDensity).toBe(false)
    expect(plan.count).toBe(100)
    expect(planTimestamps(plan)).toHaveLength(100)
  })

  it('plans interval sampling end-exclusive and count timestamps exactly', () => {
    const every = buildSamplingPlan({
      every: 0.5,
      durationSec: 2,
      budget: 1200
    })
    expect(every.count).toBe(4)
    expect(planTimestamps(every)).toEqual([0, 0.5, 1, 1.5])

    const count = buildSamplingPlan({ count: 3, durationSec: 2, budget: null })
    expect(planTimestamps(count)).toHaveLength(3)
    expect(planTimestamps(count).every((time) => time < 2)).toBe(true)
  })

  it('does not mark exact-budget plans capped and rejects empty ranges', () => {
    expect(buildSamplingPlan({ count: 3, durationSec: 3, budget: 3 }).capped).toBe(false)
    expect(() => buildSamplingPlan({ every: 1, durationSec: 3, from: 3 })).toThrowError(
      /before the source duration/
    )
    expect(() => buildSamplingPlan({ at: [4], durationSec: 3, budget: 10 })).toThrowError(
      /No --at timestamps/
    )
  })

  it('rejects multiple sampling modes', () => {
    expect(() => buildSamplingPlan({ every: 1, count: 10, durationSec: 60 })).toThrow(
      GvfError
    )
  })
})

describe('selection predicates', () => {
  const frames: FrameRecord[] = [
    {
      schema: SCHEMA_FRAME,
      id: '1',
      index: 0,
      timeMs: 0,
      timeSec: 0,
      path: '/f1.jpg',
      metrics: { composite: 0.9, sharpness: 0.9, sceneIndex: 0, duplicateOfId: null },
      detections: [
        {
          classId: 0,
          className: 'person',
          group: 'people',
          confidence: 0.9,
          box: { x: 0.1, y: 0.1, width: 0.2, height: 0.5 }
        }
      ],
      text: { hasText: false, coverage: 0, regionCount: 0 }
    },
    {
      schema: SCHEMA_FRAME,
      id: '2',
      index: 1,
      timeMs: 500,
      timeSec: 0.5,
      path: '/f2.jpg',
      metrics: { composite: 0.5, sharpness: 0.4, sceneIndex: 0, duplicateOfId: '1' },
      detections: [],
      text: { hasText: true, coverage: 0.2, regionCount: 1 }
    }
  ]

  it('filters with person and without-text', () => {
    const filtered = filterFrames(frames, { with: ['person'], withoutText: true })
    expect(filtered.map((f) => f.id)).toEqual(['1'])
  })

  it('builds selections with reasons', () => {
    const sel = buildSelectionsFile(frames, {
      with: ['person'],
      withoutText: true,
      rank: 'sharpness',
      dedupe: true,
      bestPerScene: 1
    })
    expect(sel.selections).toHaveLength(1)
    expect(sel.selections[0]?.reasons.length).toBeGreaterThan(0)
  })

  it('supports combined with/withAny/without over complete detections', () => {
    const rich = {
      ...frames[0]!,
      detections: [
        ...frames[0]!.detections!,
        {
          classId: 63,
          className: 'laptop',
          group: 'products' as const,
          confidence: 0.8,
          box: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 }
        }
      ]
    }
    expect(
      filterFrames([rich], {
        with: ['person'],
        withAny: ['laptop', 'dog'],
        without: ['car']
      })
    ).toHaveLength(1)
    expect(filterFrames([rich], { without: ['laptop'] })).toHaveLength(0)
  })

  it('keeps people preset usable without blocked text predicates', () => {
    expect(applyPreset('people').withoutText).toBeUndefined()
  })

  it('merges only defined preset overrides while preserving false', () => {
    expect(
      applyPreset('representative', {
        rank: undefined,
        dedupe: undefined,
        bestPerScene: undefined
      })
    ).toMatchObject({ rank: 'quality', dedupe: true, bestPerScene: 1 })
    expect(applyPreset('representative', { dedupe: false }).dedupe).toBe(false)
  })

  it('reuses detection data only at an equal or lower stored threshold', () => {
    expect(canReuseDetections(0.2, 0.4)).toBe(true)
    expect(canReuseDetections(0.4, 0.4)).toBe(true)
    expect(canReuseDetections(0.5, 0.4)).toBe(false)
    expect(canReuseDetections(undefined, 0.4)).toBe(false)
  })

  it('fails every text predicate when verified metadata is unavailable', async () => {
    await expect(
      selectFrames('/missing.mp4', { withoutText: true })
    ).rejects.toMatchObject({
      code: 'TEXT_VISION_BLOCKED'
    })
    await expect(
      selectFrames('/missing.mp4', { minTextCoverage: 0.1 })
    ).rejects.toMatchObject({ code: 'TEXT_VISION_BLOCKED' })
  })
})

describe('safe outputs and source isolation', () => {
  it('rejects non-empty output and preserves unrelated files on overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gvf-output-'))
    const sentinel = join(root, 'keep.txt')
    await writeFile(sentinel, 'keep')
    await writeFile(join(root, 'frame_000001.jpg'), 'old')
    await expect(prepareOutputDirectory(root)).rejects.toMatchObject({ code: 'GUARD' })
    await prepareOutputDirectory(root, { overwrite: true })
    expect(await readFile(sentinel, 'utf8')).toBe('keep')
    await expect(readFile(join(root, 'frame_000001.jpg'))).rejects.toBeTruthy()
  })

  it('disambiguates duplicate basenames for batch subfolders', () => {
    expect(sourceSubdirectories(['/a/clip.mp4', '/b/clip.mov', '/b/other.mp4'])).toEqual([
      'clip',
      'clip-2',
      'other'
    ])
  })

  it('rejects selections created for a different source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gvf-selection-'))
    const selections = join(root, 'selections.json')
    await atomicWriteJson(selections, {
      schema: 'gvf.selections/v1alpha1',
      createdAt: new Date().toISOString(),
      sourcePath: '/video-a.mp4',
      selections: [{ frameId: '1', timeMs: 0, timeSec: 0, reasons: [] }]
    })
    await expect(
      exportFrames('/video-b.mp4', { selection: selections, output: join(root, 'out') })
    ).rejects.toMatchObject({ code: 'EXPORT_FAILED' })
  })
})

describe('workspace IO', () => {
  it('creates workspace and atomically writes frames.jsonl', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gvf-ws-'))
    const { paths } = await createWorkspace({ root, sourcePath: '/video.mp4' })
    const manifest = await readManifest(root)
    expect(manifest.schema).toBe('gvf.manifest/v1alpha1')
    await writeFrameRecords(root, [
      {
        schema: SCHEMA_FRAME,
        id: 'frame-000000',
        index: 0,
        timeMs: 0,
        timeSec: 0,
        path: join(paths.framesDir, 'frame_000001.jpg')
      }
    ])
    const records = await readFrameRecords(root)
    expect(records).toHaveLength(1)
    expect(records[0]!.path).toBe(join(paths.framesDir, 'frame_000001.jpg'))
    const rawLine = (await readFile(join(root, 'frames.jsonl'), 'utf8')).trim()
    expect(JSON.parse(rawLine).path).toBe('frames/frame_000001.jpg')
    await atomicWriteJson(join(root, 'test.json'), { ok: true })
    expect(JSON.parse(await readFile(join(root, 'test.json'), 'utf8')).ok).toBe(true)
  })

  it('persists canonical absolute source identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gvf-source-'))
    const relativeSource = 'fixtures/video.mp4'
    await createWorkspace({ root, sourcePath: relativeSource })
    const manifest = await readManifest(root)
    expect(manifest.source.path).toBe(join(process.cwd(), relativeSource))
  })

  it('rejects extraction-only selection when analysis is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gvf-select-metrics-'))
    const source = join(root, 'video.mp4')
    const { paths } = await createWorkspace({ root, sourcePath: source })
    await writeFrameRecords(root, [
      {
        schema: SCHEMA_FRAME,
        id: 'frame-000000',
        index: 0,
        timeMs: 0,
        timeSec: 0,
        path: join(paths.framesDir, 'frame_000001.jpg')
      }
    ])
    await expect(
      selectFrames(source, { workspace: root, analyze: false, detect: false })
    ).rejects.toMatchObject({
      code: 'SELECT_FAILED',
      message: expect.stringContaining('requires smart analysis metrics')
    })
  })

  it('uses an explicit vision model directory for runtime inspection', async () => {
    const modelsDir = await mkdtemp(join(tmpdir(), 'gvf-runtime-models-'))
    const status = await inspectRuntime({ modelsDir })
    expect(status.vision.modelsDir).toBe(modelsDir)
    expect(status.vision.yoloxPath).toBe(join(modelsDir, 'yolox_nano.onnx'))
  })
})
