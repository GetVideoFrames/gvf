/**
 * Probe video metadata with rotation-safe display dimensions.
 */

import {
  buildFfprobeArgs,
  displayDimensions,
  parseFps,
  parseStreamRotation,
  runTool
} from '@gvf/ffmpeg'
import { ProbeResultSchema, SCHEMA_PROBE, type ProbeResult } from '../schemas/v1alpha1.js'
import { GvfError } from '../errors/index.js'
import { requireFFmpeg } from '../runtime/runtime.js'
import type { ProgressReporter } from '../runtime/progress.js'
import { createProgressEvent } from '../runtime/progress.js'
import { canonicalSourcePath } from '../source.js'

interface FfprobeJson {
  format?: {
    duration?: string
    size?: string
    format_name?: string
  }
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    avg_frame_rate?: string
    r_frame_rate?: string
    tags?: Record<string, string>
    side_data_list?: Array<{
      side_data_type?: string
      rotation?: number | string
    }>
  }>
}

export async function probeVideo(
  inputPath: string,
  options: {
    signal?: AbortSignal
    ffmpegPath?: string
    ffprobePath?: string
    onProgress?: ProgressReporter
  } = {}
): Promise<ProbeResult> {
  const sourcePath = canonicalSourcePath(inputPath)
  options.onProgress?.(createProgressEvent('probe', 0, 1, sourcePath))
  const paths = await requireFFmpeg({
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath
  })
  const args = buildFfprobeArgs(sourcePath)
  const result = await runTool(paths.ffprobePath, args, { signal: options.signal })
  if (result.code !== 0) {
    throw new GvfError(
      'PROBE_FAILED',
      `ffprobe failed: ${result.stderr || `exit ${result.code}`}`,
      {
        details: { path: sourcePath }
      }
    )
  }
  let json: FfprobeJson
  try {
    json = JSON.parse(result.stdout) as FfprobeJson
  } catch (error) {
    throw new GvfError('PROBE_FAILED', 'ffprobe returned invalid JSON.', { cause: error })
  }
  const video = json.streams?.find((s) => s.codec_type === 'video')
  if (!video) {
    throw new GvfError('PROBE_FAILED', 'No video stream found.', {
      details: { path: sourcePath }
    })
  }
  const durationSec = Number(json.format?.duration ?? 0)
  const codedWidth = video.width ?? 0
  const codedHeight = video.height ?? 0
  const rotation = parseStreamRotation(video)
  const display = displayDimensions(codedWidth, codedHeight, rotation)
  const probe = ProbeResultSchema.parse({
    schema: SCHEMA_PROBE,
    path: sourcePath,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: display.width,
    height: display.height,
    codedWidth,
    codedHeight,
    rotation,
    fps: parseFps(video.avg_frame_rate) || parseFps(video.r_frame_rate),
    codec: video.codec_name ?? 'unknown',
    container: json.format?.format_name ?? 'unknown',
    hasAudio: Boolean(json.streams?.some((s) => s.codec_type === 'audio')),
    sizeBytes: Number(json.format?.size ?? 0)
  })
  options.onProgress?.(createProgressEvent('probe', 1, 1, sourcePath))
  return probe
}

export async function probeVideos(
  inputs: string[],
  options: {
    signal?: AbortSignal
    ffmpegPath?: string
    ffprobePath?: string
    onProgress?: ProgressReporter
  } = {}
): Promise<{ schema: 'gvf.result/v1alpha1'; command: 'probe'; data: ProbeResult[] }> {
  const data: ProbeResult[] = []
  for (let i = 0; i < inputs.length; i += 1) {
    options.onProgress?.(createProgressEvent('probe', i, inputs.length, inputs[i]))
    data.push(await probeVideo(inputs[i]!, options))
  }
  return { schema: 'gvf.result/v1alpha1', command: 'probe', data }
}
