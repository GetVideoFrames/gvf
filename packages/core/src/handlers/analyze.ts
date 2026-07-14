/**
 * Analyze candidate frames — scene/sharpness/exposure/similarity/duplicate/composite.
 */

import { buildAnalysisDecodeArgs, runToolBinary } from '@gvf/ffmpeg'
import { analyzeSmartFrames, type SmartFrameInput } from '../smart/index.js'
import { GvfError } from '../errors/index.js'
import { requireFFmpeg } from '../runtime/runtime.js'
import { createProgressEvent, type ProgressReporter } from '../runtime/progress.js'
import {
  readFrameRecords,
  readManifest,
  writeFrameRecords,
  writeManifest
} from '../workspace/io.js'
import { extractFrames } from './extract.js'
import type { FrameRecord } from '../schemas/v1alpha1.js'
import { canonicalSourcePath } from '../source.js'

export interface AnalysisMetricRequirements {
  rank?: 'quality' | 'sharpness' | 'exposure'
  dedupe?: boolean
  bestPerScene?: boolean
  minQuality?: boolean
}

export function hasCompleteAnalysisMetrics(
  frames: readonly FrameRecord[],
  requirements: AnalysisMetricRequirements = {}
): boolean {
  const rank = requirements.rank ?? 'quality'
  return (
    frames.length > 0 &&
    frames.every((frame) => {
      const metrics = frame.metrics
      if (!metrics) return false
      if (rank === 'quality' && metrics.composite == null) return false
      if (rank === 'sharpness' && metrics.sharpness == null) return false
      if (rank === 'exposure' && metrics.exposure == null) return false
      if (requirements.minQuality && metrics.composite == null) return false
      if (requirements.bestPerScene && metrics.sceneIndex == null) return false
      if (
        requirements.dedupe &&
        (!Array.isArray(metrics.hash) ||
          !Object.prototype.hasOwnProperty.call(metrics, 'duplicateOfId'))
      ) {
        return false
      }
      return true
    })
  )
}

async function decodeCandidatePixels(
  ffmpegPath: string,
  framePaths: string[],
  width = 64,
  height = 36,
  signal?: AbortSignal
): Promise<SmartFrameInput['pixels'][]> {
  if (framePaths.length === 0) return []
  const channels = 3
  const bytesPerFrame = width * height * channels
  const first = framePaths[0]!
  const inputPattern = first.replace(/frame_\d{6}(\.[^.]+)$/, 'frame_%06d$1')
  if (inputPattern === first) {
    // Fall back to per-frame decode if pattern doesn't match
    const pixels: SmartFrameInput['pixels'][] = []
    for (const path of framePaths) {
      const args = buildAnalysisDecodeArgs(path, width, height)
      // single file: remove framerate sequence assumption — use -i file
      const singleArgs = [
        '-v',
        'error',
        '-i',
        path,
        '-vf',
        `scale=${width}:${height}`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1'
      ]
      void args
      const result = await runToolBinary(ffmpegPath, singleArgs, { signal })
      if (result.code !== 0 || result.stdout.length < bytesPerFrame) {
        throw new GvfError('ANALYZE_FAILED', 'Could not decode analysis frame.', {
          details: { path }
        })
      }
      pixels.push({
        data: new Uint8Array(result.stdout.subarray(0, bytesPerFrame)),
        width,
        height,
        channels: 3
      })
    }
    return pixels
  }

  const args = buildAnalysisDecodeArgs(inputPattern, width, height)
  const result = await runToolBinary(ffmpegPath, args, {
    signal,
    maxBuffer: bytesPerFrame * framePaths.length + 1024 * 1024
  })
  if (result.code !== 0) {
    throw new GvfError(
      'ANALYZE_FAILED',
      result.stderr || 'FFmpeg could not decode analysis frames.'
    )
  }
  const expected = bytesPerFrame * framePaths.length
  if (result.stdout.length < expected) {
    throw new GvfError('ANALYZE_FAILED', 'FFmpeg returned incomplete analysis frames.')
  }
  return framePaths.map((_, index) => ({
    data: new Uint8Array(
      result.stdout.subarray(index * bytesPerFrame, (index + 1) * bytesPerFrame)
    ),
    width,
    height,
    channels: 3
  }))
}

export async function analyzeFrames(
  input: string,
  options: {
    workspace?: string
    signal?: AbortSignal
    ffmpegPath?: string
    ffprobePath?: string
    onProgress?: ProgressReporter
    every?: number
    fps?: number
    count?: number
    at?: number[]
    all?: boolean
    from?: number
    to?: number
    budget?: number
  } = {}
): Promise<{
  schema: 'gvf.result/v1alpha1'
  command: 'analyze'
  workspace: string
  summary: {
    sampledCount: number
    sceneCount: number
    blurryCount: number
    duplicateCount: number
    recommendedCount: number
  }
  frames: FrameRecord[]
}> {
  input = canonicalSourcePath(input)
  options.onProgress?.(createProgressEvent('analyze', 0, 1, 'prepare'))

  let workspace = options.workspace
  if (!workspace) {
    // Treat input as video → extract candidates first
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
      ffprobePath: options.ffprobePath,
      onProgress: options.onProgress
    })
    workspace = extracted.workspace!
  }

  const manifest = await readManifest(workspace)
  let frames = await readFrameRecords(workspace)
  if (frames.length === 0) {
    throw new GvfError('ANALYZE_FAILED', 'Workspace has no candidate frames.', {
      details: { workspace }
    })
  }

  const ffmpeg = await requireFFmpeg({
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath
  })

  options.onProgress?.(createProgressEvent('analyze', 0, frames.length, 'decode'))
  const pixels = await decodeCandidatePixels(
    ffmpeg.ffmpegPath,
    frames.map((f) => f.path),
    64,
    36,
    options.signal
  )

  const inputs: SmartFrameInput[] = frames.map((frame, index) => ({
    id: frame.id,
    timeMs: frame.timeMs,
    pixels: pixels[index]!
  }))

  const scan = analyzeSmartFrames(inputs)
  const byId = new Map(scan.frames.map((f) => [f.id, f]))

  frames = frames.map((frame) => {
    const metrics = byId.get(frame.id)
    if (!metrics) return frame
    return {
      ...frame,
      metrics: {
        sceneIndex: metrics.sceneIndex,
        sceneDifference: metrics.sceneDifference,
        sharpness: metrics.componentScores.sharpness,
        exposure: metrics.componentScores.exposure,
        uniqueness: metrics.componentScores.uniqueness,
        scenePosition: metrics.componentScores.scenePosition,
        composite: metrics.compositeScore,
        blurVariance: metrics.blurVariance,
        exposureMean: metrics.exposureMean,
        exposureClippedRatio: metrics.exposureClippedRatio,
        duplicateOfId: metrics.duplicateOfId ?? null,
        hash: Array.from(metrics.hash)
      }
    }
  })

  await writeFrameRecords(workspace, frames)
  await writeManifest(workspace, manifest)

  options.onProgress?.(
    createProgressEvent('analyze', frames.length, frames.length, 'done')
  )

  return {
    schema: 'gvf.result/v1alpha1',
    command: 'analyze',
    workspace,
    summary: {
      sampledCount: scan.sampledCount,
      sceneCount: scan.sceneCount,
      blurryCount: scan.blurryCount,
      duplicateCount: scan.duplicateCount,
      recommendedCount: scan.recommendedCount
    },
    frames
  }
}
