import { describe, expect, it } from 'vitest'
import {
  COCO_CLASS_NAMES,
  COCO_CLASS_COUNT,
  VISION_GROUP_CLASSES,
  resolveObjectQuery,
  cocoClassId,
  decodeYoloxDetections,
  yoloxCellCount,
  measureTextMap,
  buildTextDetInput,
  ModelManifestSchema,
  getVisionSetupPlans,
  setupVision,
  inspectVision,
  createDefaultVisionProvider,
  defaultYoloxPath
} from '@gvf/vision'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('COCO labels and groups', () => {
  it('exposes all 80 native classes', () => {
    expect(COCO_CLASS_NAMES).toHaveLength(COCO_CLASS_COUNT)
    expect(COCO_CLASS_COUNT).toBe(80)
    expect(cocoClassId('laptop')).toBe(63)
    expect(cocoClassId('person')).toBe(0)
  })

  it('resolves class and group queries', () => {
    expect(resolveObjectQuery('laptop').classIds).toEqual([63])
    expect(resolveObjectQuery('people').kind).toBe('group')
    expect(resolveObjectQuery('products').classIds).toEqual([
      ...VISION_GROUP_CLASSES.products
    ])
  })

  it('documents products as curated subset not universal detection', () => {
    expect(VISION_GROUP_CLASSES.products.length).toBeLessThan(80)
    expect(VISION_GROUP_CLASSES.products).not.toContain(0)
  })
})

describe('guided vision setup', () => {
  it('exposes the audited plan and requires explicit noninteractive consent', async () => {
    const modelsDir = await mkdtemp(join(tmpdir(), 'gvf-models-'))
    const [plan] = await getVisionSetupPlans({ modelsDir, only: 'yolox-nano' })
    expect(plan).toMatchObject({
      releaseTag: '0.1.1rc0',
      sizeBytes: 3659407,
      sha256: 'c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d'
    })
    await expect(
      setupVision({ modelsDir, only: 'yolox-nano', interactive: false })
    ).rejects.toMatchObject({ code: 'VISION_SETUP_CONFIRMATION_REQUIRED' })
  })

  it('rejects an unknown --only model before creating or downloading', async () => {
    const modelsDir = join(tmpdir(), `gvf-models-unknown-${Date.now()}`)
    await expect(
      setupVision({ modelsDir, only: 'unknown', yes: true })
    ).rejects.toMatchObject({ code: 'USAGE' })
    expect(existsSync(modelsDir)).toBe(false)
  })

  it('does not report a corrupt model as ready', async () => {
    const modelsDir = await mkdtemp(join(tmpdir(), 'gvf-models-'))
    await writeFile(join(modelsDir, 'yolox_nano.onnx'), 'corrupt')
    const status = await inspectVision(modelsDir)
    expect(status.filePresent).toBe(true)
    expect(status.checksumValid).toBe(false)
    expect(status.objectsReady).toBe(false)
  })

  it('uses the same custom directory for inspection and provider creation', async () => {
    const modelsDir = await mkdtemp(join(tmpdir(), 'gvf-models-path-'))
    const status = await inspectVision(modelsDir)
    const provider = createDefaultVisionProvider(defaultYoloxPath(modelsDir))
    expect(status.yoloxPath).toBe(join(modelsDir, 'yolox_nano.onnx'))
    expect(provider.info()?.path).toBe(status.yoloxPath)
  })
})

describe('YOLOX decode', () => {
  it('reports expected cell count for 416 input', () => {
    expect(yoloxCellCount(416)).toBe(3549)
  })

  it('returns empty detections for zero tensor', () => {
    const cells = yoloxCellCount()
    const data = new Float32Array(cells * 85)
    expect(decodeYoloxDetections(data)).toEqual([])
  })
})

describe('text map regions', () => {
  it('measures presence, coverage, count, and regions', () => {
    const width = 8
    const height = 8
    const map = new Float32Array(width * height)
    // blob in top-left
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        map[y * width + x] = 0.9
      }
    }
    const result = measureTextMap(map, width, height, { minRegionPixels: 4 })
    expect(result.hasText).toBe(true)
    expect(result.regionCount).toBe(1)
    expect(result.regions[0]?.width).toBeGreaterThan(0)
    expect(result.coverage).toBeGreaterThan(0)
  })

  it('builds text det input tensor shape', () => {
    const rgb = new Uint8Array(4 * 4 * 3)
    const input = buildTextDetInput(rgb, 4, 4)
    expect(input).toHaveLength(3 * 16)
  })
})

describe('model manifest', () => {
  it('marks text weights blocked and yolox available', () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'model-manifest.json'
    )
    const manifest = ModelManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    const yolox = manifest.models.find((m) => m.id === 'yolox-nano')
    const text = manifest.models.find((m) => m.id === 'text-det-ppocrv4')
    expect(yolox?.status).toBe('available')
    expect(text?.status).toBe('blocked')
  })
})
