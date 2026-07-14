/**
 * Detect objects (and optionally text) on candidate frames.
 */

import { buildYoloxDecodeArgs, runToolBinary } from '@gvf/ffmpeg'
import {
  YOLOX_INPUT_SIZE,
  createDefaultVisionProvider,
  defaultYoloxPath,
  inspectVision,
  OBJECT_SETUP_HINT,
  TEXT_SETUP_BLOCKED_HINT,
  VisionNotReadyError,
  TextVisionBlockedError,
  resolveObjectQuery
} from '@gvf/vision'
import { GvfError } from '../errors/index.js'
import { requireFFmpeg, setupRuntime } from '../runtime/runtime.js'
import { createProgressEvent, type ProgressReporter } from '../runtime/progress.js'
import {
  readFrameRecords,
  readManifest,
  writeFrameRecords,
  writeManifest
} from '../workspace/io.js'
import { extractFrames } from './extract.js'
import { analyzeFrames, hasCompleteAnalysisMetrics } from './analyze.js'
import type { FrameRecord } from '../schemas/v1alpha1.js'
import { DetectionConfidenceSchema, parseUsage } from '../validation/options.js'
import { canonicalSourcePath } from '../source.js'

export function canReuseDetections(
  storedThreshold: number | undefined,
  requestedThreshold: number
): boolean {
  return storedThreshold != null && storedThreshold <= requestedThreshold
}

export interface DetectOptions {
  workspace?: string
  object?: string[]
  group?: string[]
  people?: boolean
  text?: boolean
  minConfidence?: number
  interactive?: boolean
  confirmVisionSetup?: (plan: unknown) => Promise<boolean>
  signal?: AbortSignal
  ffmpegPath?: string
  ffprobePath?: string
  modelsDir?: string
  onProgress?: ProgressReporter
  every?: number
  fps?: number
  count?: number
  at?: number[]
  all?: boolean
  from?: number
  to?: number
  budget?: number
  /** Ensure analyze metrics exist first. */
  analyze?: boolean
}

async function decodeYoloxRgb(
  ffmpegPath: string,
  imagePath: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const args = buildYoloxDecodeArgs(imagePath, YOLOX_INPUT_SIZE)
  const result = await runToolBinary(ffmpegPath, args, { signal })
  const expected = YOLOX_INPUT_SIZE * YOLOX_INPUT_SIZE * 3
  if (result.code !== 0 || result.stdout.length < expected) {
    throw new GvfError(
      'DETECT_FAILED',
      `Could not decode frame for detection: ${imagePath}`
    )
  }
  return new Uint8Array(result.stdout.subarray(0, expected))
}

export async function detectFrames(
  input: string,
  options: DetectOptions = {}
): Promise<{
  schema: 'gvf.result/v1alpha1'
  command: 'detect'
  workspace: string
  summary: {
    framesWithObjects: number
    detectionCount: number
    textFrames: number
    textBlocked: boolean
  }
  frames: FrameRecord[]
}> {
  input = canonicalSourcePath(input)
  const wantObjects =
    (options.object?.length ?? 0) > 0 ||
    (options.group?.length ?? 0) > 0 ||
    options.people === true ||
    (!options.text && (options.object == null || options.object.length === 0))

  const wantText = options.text === true
  const persistenceThreshold = parseUsage(
    DetectionConfidenceSchema,
    options.minConfidence ?? 0.4,
    '--min-confidence'
  )

  if (wantText) {
    // Text is blocked for public release — fail clearly in noninteractive;
    // interactive still cannot install.
    throw new GvfError('TEXT_VISION_BLOCKED', TEXT_SETUP_BLOCKED_HINT, {
      hint: 'Text detection interfaces are ready; weight download is blocked. See docs/PROVENANCE.md.'
    })
  }

  let visionStatus = await inspectVision(options.modelsDir)
  if (wantObjects && !visionStatus.objectsReady) {
    if (options.interactive && options.confirmVisionSetup) {
      await setupRuntime('vision', {
        interactive: true,
        modelsDir: options.modelsDir,
        confirmVisionSetup: options.confirmVisionSetup
      })
      visionStatus = await inspectVision(options.modelsDir)
    }
    if (!visionStatus.objectsReady) {
      throw new GvfError('VISION_NOT_READY', 'Object detection runtime is not ready.', {
        hint:
          `${OBJECT_SETUP_HINT} Noninteractive setup requires ` +
          '`gvf setup vision --yes`.'
      })
    }
  }

  // Vision is preflighted before candidate extraction/analysis to avoid wasted work.
  let workspace = options.workspace
  if (!workspace) {
    if (options.analyze !== false) {
      const analyzed = await analyzeFrames(input, options)
      workspace = analyzed.workspace
    } else {
      const extracted = await extractFrames(input, {
        every: options.every,
        fps: options.fps,
        count: options.count,
        at: options.at,
        all: options.all,
        from: options.from,
        to: options.to,
        budget: options.budget,
        candidates: true,
        signal: options.signal,
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath
      })
      workspace = extracted.workspace!
    }
  } else {
    const manifest = await readManifest(workspace)
    if (canonicalSourcePath(manifest.source.path) !== input) {
      throw new GvfError(
        'DETECT_FAILED',
        'Workspace source does not match the requested input video.',
        {
          details: {
            requestedSource: input,
            workspaceSource: manifest.source.path,
            workspace
          }
        }
      )
    }
    if (options.analyze !== false) {
      const existingFrames = await readFrameRecords(workspace)
      if (!hasCompleteAnalysisMetrics(existingFrames)) {
        await analyzeFrames(input, {
          workspace,
          signal: options.signal,
          ffmpegPath: options.ffmpegPath,
          ffprobePath: options.ffprobePath,
          onProgress: options.onProgress
        })
      }
    }
  }

  const provider = createDefaultVisionProvider(defaultYoloxPath(options.modelsDir))
  const ffmpeg = await requireFFmpeg({
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath
  })
  const manifest = await readManifest(workspace)
  const frames = await readFrameRecords(workspace)

  // Optional class filter after detection
  const filterIds = new Set<number>()
  if (options.people) {
    for (const id of resolveObjectQuery('people').classIds) filterIds.add(id)
  }
  for (const g of options.group ?? []) {
    for (const id of resolveObjectQuery(g).classIds) filterIds.add(id)
  }
  for (const o of options.object ?? []) {
    for (const id of resolveObjectQuery(o).classIds) filterIds.add(id)
  }

  let detectionCount = 0
  let framesWithObjects = 0

  for (let i = 0; i < frames.length; i += 1) {
    options.onProgress?.(createProgressEvent('detect', i, frames.length, frames[i]!.id))
    const frame = frames[i]!
    try {
      const rgb = await decodeYoloxRgb(ffmpeg.ffmpegPath, frame.path, options.signal)
      const detections = await provider.detectObjects({
        rgb,
        frameWidth: manifest.source.probe?.width ?? YOLOX_INPUT_SIZE,
        frameHeight: manifest.source.probe?.height ?? YOLOX_INPUT_SIZE,
        scoreThreshold: persistenceThreshold
      })
      const summaryDetections =
        filterIds.size > 0
          ? detections.filter((d: { classId: number }) => filterIds.has(d.classId))
          : detections
      frames[i] = {
        ...frame,
        detections: detections.map(
          (d: {
            classId: number
            className: string
            group?: 'people' | 'animals' | 'vehicles' | 'products'
            confidence: number
            box: { x: number; y: number; width: number; height: number }
          }) => ({
            classId: d.classId,
            className: d.className,
            group: d.group,
            confidence: d.confidence,
            box: d.box
          })
        )
      }
      if (summaryDetections.length > 0) {
        framesWithObjects += 1
        detectionCount += summaryDetections.length
      }
    } catch (error: unknown) {
      if (error instanceof VisionNotReadyError) {
        throw new GvfError('VISION_NOT_READY', String(error.message), {
          hint: String(error.hint)
        })
      }
      if (error instanceof TextVisionBlockedError) {
        throw new GvfError('TEXT_VISION_BLOCKED', String(error.message), {
          hint: String(error.hint)
        })
      }
      throw error
    }
  }

  await writeFrameRecords(workspace, frames)
  const info = provider.info()
  await writeManifest(workspace, {
    ...manifest,
    providers: {
      ...manifest.providers,
      vision: info
        ? {
            providerId: info.providerId,
            modelId: info.modelId,
            version: info.version,
            provenanceId: info.provenanceId,
            detectionsComplete: true,
            detectionMinConfidence: persistenceThreshold,
            textComplete: false
          }
        : undefined
    }
  })

  options.onProgress?.(
    createProgressEvent('detect', frames.length, frames.length, 'done')
  )

  return {
    schema: 'gvf.result/v1alpha1',
    command: 'detect',
    workspace,
    summary: {
      framesWithObjects,
      detectionCount,
      textFrames: 0,
      textBlocked: true
    },
    frames
  }
}
