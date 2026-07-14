/**
 * Frame extraction — candidate (workspace) and deterministic final-quality extract.
 */

import { readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { z } from 'zod/v4'
import {
  buildAllFramesArgs,
  buildExtractArgs,
  buildExtractFrameArgs,
  extensionForFormat,
  probeFrameTimestamps,
  runTool,
  type OutputFormat
} from '@gvf/ffmpeg'
import { GvfError } from '../errors/index.js'
import { requireFFmpeg } from '../runtime/runtime.js'
import { createProgressEvent, type ProgressReporter } from '../runtime/progress.js'
import {
  buildSamplingPlan,
  estimateFrameCount,
  planTimestamps,
  DEFAULT_ALL_BYTES_WARN,
  DEFAULT_ALL_FRAME_WARN
} from '../sampling/plan.js'
import { probeVideo } from './probe.js'
import {
  createWorkspace,
  atomicWriteFile,
  atomicWriteJson,
  readManifest,
  writeFrameRecords,
  writeManifest,
  workspacePaths
} from '../workspace/io.js'
import { SCHEMA_FRAME, type FrameRecord, type SamplingPlan } from '../schemas/v1alpha1.js'
import { renderUniqueFrameFilenames } from '../naming.js'
import { prepareOutputDirectory, sourceSubdirectories } from '../io/output.js'
import {
  OutputFormatSchema,
  parseUsage,
  PositiveFiniteSchema,
  PositiveIntegerSchema,
  validateRange,
  validateUnitRange
} from '../validation/options.js'
import { canonicalSourcePath } from '../source.js'

export interface ExtractOptions {
  every?: number
  fps?: number
  count?: number
  at?: number[]
  all?: boolean
  from?: number
  to?: number
  budget?: number
  format?: OutputFormat
  quality?: number
  maxWidth?: number
  output?: string
  workspace?: string
  filenameTemplate?: string
  /** Candidate mode writes a GVF workspace (low-res review assets). */
  candidates?: boolean
  overwrite?: boolean
  force?: boolean
  maxOutputFrames?: number
  interactive?: boolean
  confirmAll?: () => Promise<boolean>
  signal?: AbortSignal
  ffmpegPath?: string
  ffprobePath?: string
  onProgress?: ProgressReporter
  /** Estimated bytes per frame for --all size guard. */
  estimatedBytesPerFrame?: number
}

async function confirmAllGuard(options: {
  estimatedFrames: number
  estimatedBytes: number
  force?: boolean
  interactive?: boolean
  maxOutputFrames?: number
  confirmAll?: () => Promise<boolean>
}): Promise<void> {
  if (
    options.maxOutputFrames != null &&
    options.estimatedFrames > options.maxOutputFrames
  ) {
    throw new GvfError(
      'GUARD',
      `Estimated ${options.estimatedFrames} frames exceeds --max-output-frames ${options.maxOutputFrames}.`
    )
  }
  const overFrames = options.estimatedFrames > DEFAULT_ALL_FRAME_WARN
  const overBytes = options.estimatedBytes > DEFAULT_ALL_BYTES_WARN
  if (!overFrames && !overBytes) return
  if (options.force) return
  if (options.interactive && options.confirmAll) {
    const ok = await options.confirmAll()
    if (ok) return
  }
  throw new GvfError(
    'GUARD',
    `Extract --all would produce ~${options.estimatedFrames} frames ` +
      `(~${Math.round(options.estimatedBytes / (1024 * 1024))} MiB estimated). ` +
      `Re-run with --force (noninteractive) or confirm in a TTY.`,
    {
      details: {
        estimatedFrames: options.estimatedFrames,
        estimatedBytes: options.estimatedBytes
      }
    }
  )
}

export async function extractFrames(
  inputPath: string,
  options: ExtractOptions = {}
): Promise<{
  schema: 'gvf.result/v1alpha1'
  command: 'extract'
  workspace?: string
  outputDir: string
  sampling: SamplingPlan
  frames: FrameRecord[]
  manifestPath: string
  framesPath: string
}> {
  inputPath = canonicalSourcePath(inputPath)
  const format = parseUsage(
    OutputFormatSchema,
    options.format ?? 'image/jpeg',
    'output format'
  )
  const quality = validateUnitRange(options.quality ?? 0.85, '--quality')!
  if (options.maxWidth != null) {
    parseUsage(PositiveIntegerSchema, options.maxWidth, '--max-width')
  }
  if (options.maxOutputFrames != null) {
    parseUsage(PositiveIntegerSchema, options.maxOutputFrames, '--max-output-frames')
  }
  if (options.every != null) parseUsage(PositiveFiniteSchema, options.every, '--every')
  if (options.fps != null) parseUsage(PositiveFiniteSchema, options.fps, '--fps')
  if (options.count != null) parseUsage(PositiveIntegerSchema, options.count, '--count')
  if (options.budget != null)
    parseUsage(PositiveIntegerSchema, options.budget, '--budget')
  for (const timestamp of options.at ?? []) {
    parseUsage(z.number().finite().nonnegative(), timestamp, '--at')
  }
  validateRange(options.from, options.to)
  const probe = await probeVideo(inputPath, options)
  const candidates =
    options.candidates !== false && !options.output ? true : Boolean(options.candidates)

  // --all guard (final extract path and candidate path)
  if (options.all) {
    const estimatedFrames = estimateFrameCount({
      durationSec: probe.durationSec,
      fps: probe.fps || 30,
      from: options.from,
      to: options.to,
      strategy: 'all'
    })
    const bytesPer = options.estimatedBytesPerFrame ?? 200_000
    await confirmAllGuard({
      estimatedFrames,
      estimatedBytes: estimatedFrames * bytesPer,
      force: options.force,
      interactive: options.interactive,
      maxOutputFrames: options.maxOutputFrames,
      confirmAll: options.confirmAll
    })
  }

  let sampling = buildSamplingPlan({
    every: options.every,
    fps: options.fps,
    count: options.count,
    at: options.at,
    all: options.all,
    from: options.from,
    to: options.to,
    budget: candidates ? (options.budget ?? 1200) : null,
    durationSec: probe.durationSec,
    sourceFps: probe.fps
  })

  if (options.maxOutputFrames != null && sampling.count > options.maxOutputFrames) {
    throw new GvfError(
      'GUARD',
      `Plan produces ${sampling.count} frames; exceeds --max-output-frames ${options.maxOutputFrames}.`
    )
  }

  const paths = await requireFFmpeg({
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath
  })
  let candidateAllTimestamps: number[] | undefined
  if (candidates && sampling.strategy === 'all') {
    try {
      candidateAllTimestamps = (
        await probeFrameTimestamps({
          ffprobePath: paths.ffprobePath,
          inputPath,
          fromSec: sampling.fromSec,
          toSec: sampling.toSec,
          estimatedFrames: estimateFrameCount({
            durationSec: probe.durationSec,
            fps: probe.fps || 30,
            from: sampling.fromSec,
            to: sampling.toSec,
            strategy: 'all'
          }),
          signal: options.signal
        })
      ).filter(
        (timestamp) =>
          timestamp >= (sampling.fromSec ?? 0) &&
          timestamp < (sampling.toSec ?? probe.durationSec)
      )
    } catch (error) {
      throw new GvfError(
        'EXTRACT_FAILED',
        'Candidate --all requires exact source frame timestamps.',
        { cause: error, hint: 'Use interval/count candidate sampling instead.' }
      )
    }
    if (candidateAllTimestamps.length === 0) {
      throw new GvfError(
        'EXTRACT_FAILED',
        'Candidate --all found no exact source frame timestamps.'
      )
    }
    const budget = sampling.budget!
    const capped = candidateAllTimestamps.length > budget
    const selected = capped
      ? Array.from({ length: budget }, (_, index) => {
          const sourceIndex =
            budget === 1
              ? 0
              : Math.round((index * (candidateAllTimestamps!.length - 1)) / (budget - 1))
          return candidateAllTimestamps![sourceIndex]!
        })
      : candidateAllTimestamps
    candidateAllTimestamps = selected
    sampling = {
      ...sampling,
      count: selected.length,
      capped,
      equalDensity: !capped,
      timestampBasis: 'source-pts'
    }
    if (options.maxOutputFrames != null && sampling.count > options.maxOutputFrames) {
      throw new GvfError(
        'GUARD',
        `Exact source plan produces ${sampling.count} frames; exceeds --max-output-frames ${options.maxOutputFrames}.`
      )
    }
  }

  const stem = basename(inputPath).replace(/\.[^.]+$/, '')
  const workspaceRoot =
    options.workspace ??
    (candidates
      ? join(process.cwd(), '.gvf', 'workspaces', `${stem}-${randomUUID()}`)
      : undefined)

  let outputDir: string
  if (candidates && workspaceRoot) {
    await prepareOutputDirectory(workspaceRoot, {
      overwrite: options.overwrite,
      workspace: true
    })
    const ws = await createWorkspace({ root: workspaceRoot, sourcePath: inputPath })
    outputDir = ws.paths.framesDir
    await writeManifest(workspaceRoot, {
      ...ws.manifest,
      source: { path: inputPath, probe },
      sampling,
      providers: {
        ffmpeg: {
          providerId: 'system-ffmpeg',
          version: paths.version,
          provenanceId: `ffmpeg:${paths.source}`
        }
      },
      candidateFormat: format,
      candidateMaxWidth: options.maxWidth ?? 640
    })
  } else {
    outputDir = options.output ?? join(process.cwd(), 'output', stem)
    await prepareOutputDirectory(outputDir, { overwrite: options.overwrite })
  }

  const ext = extensionForFormat(format)
  const maxWidth = options.maxWidth ?? (candidates ? 640 : undefined)
  const timestamps = candidateAllTimestamps ?? planTimestamps(sampling)
  const frames: FrameRecord[] = []
  let timestampBasis: SamplingPlan['timestampBasis'] =
    sampling.timestampBasis ?? 'planned-interval'

  // Count and capped plans use explicit timestamps so the requested count is exact.
  const useIntervalExtract =
    (sampling.strategy === 'every' || sampling.strategy === 'fps') && !sampling.capped
  const useAllFrames = sampling.strategy === 'all' && !sampling.capped

  options.onProgress?.(createProgressEvent('extract', 0, timestamps.length || 1))

  if (useAllFrames) {
    const pattern = join(outputDir, `frame_%06d.${ext}`)
    const args = buildAllFramesArgs({
      inputPath,
      outputPattern: pattern,
      format,
      quality,
      maxWidth,
      rangeStartSec: sampling.fromSec,
      rangeEndSec: sampling.toSec,
      maxFrames: candidates ? (sampling.budget ?? undefined) : undefined
    })
    const result = await runTool(paths.ffmpegPath, args, { signal: options.signal })
    if (result.code !== 0) {
      throw new GvfError(
        'EXTRACT_FAILED',
        `ffmpeg all-frame extract failed: ${result.stderr || `exit ${result.code}`}`
      )
    }
    const files = (await readdir(outputDir))
      .filter((file) => file.startsWith('frame_') && file.endsWith(`.${ext}`))
      .sort()
    let sourceTimestamps: number[] | undefined
    try {
      sourceTimestamps =
        candidateAllTimestamps ??
        (
          await probeFrameTimestamps({
            ffprobePath: paths.ffprobePath,
            inputPath,
            fromSec: sampling.fromSec,
            toSec: sampling.toSec,
            estimatedFrames: Math.max(sampling.count, files.length),
            signal: options.signal
          })
        ).filter(
          (timestamp) =>
            timestamp >= (sampling.fromSec ?? 0) &&
            timestamp < (sampling.toSec ?? probe.durationSec)
        )
    } catch (error) {
      if (candidates) {
        throw new GvfError(
          'EXTRACT_FAILED',
          'Candidate --all requires exact source frame timestamps.',
          { cause: error, hint: 'Use interval/count candidate sampling instead.' }
        )
      }
    }
    if (sourceTimestamps && sourceTimestamps.length !== files.length) {
      if (candidates) {
        throw new GvfError(
          'EXTRACT_FAILED',
          `Candidate --all emitted ${files.length} frames but ffprobe returned ${sourceTimestamps.length} source timestamps.`,
          {
            hint: 'Use interval/count candidate sampling instead of ambiguous timestamps.'
          }
        )
      }
      sourceTimestamps = undefined
    }
    const estimatedIntervalMs = probe.fps > 0 ? 1000 / probe.fps : 0
    for (let index = 0; index < files.length; index += 1) {
      const timeSec =
        sourceTimestamps?.[index] ??
        (sampling.fromSec ?? 0) + (index * estimatedIntervalMs) / 1000
      const timeMs = Math.round(timeSec * 1000)
      frames.push({
        schema: SCHEMA_FRAME,
        id: `frame-${String(index).padStart(6, '0')}`,
        index,
        timeMs,
        timeSec,
        path: join(outputDir, files[index]!)
      })
    }
    timestampBasis = sourceTimestamps ? 'source-pts' : 'estimated-fps'
  } else if (useIntervalExtract && sampling.effectiveIntervalSec) {
    const pattern = join(outputDir, `frame_%06d.${ext}`)
    const args = buildExtractArgs({
      inputPath,
      outputPattern: pattern,
      intervalSeconds: sampling.effectiveIntervalSec,
      format,
      quality,
      maxWidth,
      rangeStartSec: sampling.fromSec,
      rangeEndSec: sampling.toSec
    })
    const result = await runTool(paths.ffmpegPath, args, { signal: options.signal })
    if (result.code !== 0) {
      throw new GvfError(
        'EXTRACT_FAILED',
        `ffmpeg extract failed: ${result.stderr || `exit ${result.code}`}`
      )
    }
    const files = (await readdir(outputDir))
      .filter((f) => f.startsWith('frame_') && f.endsWith(`.${ext}`))
      .sort()
    const intervalMs = (sampling.effectiveIntervalSec ?? 0.5) * 1000
    const startMs = (sampling.fromSec ?? 0) * 1000
    for (let i = 0; i < files.length; i += 1) {
      const timeMs = Math.round(startMs + i * intervalMs)
      frames.push({
        schema: SCHEMA_FRAME,
        id: `frame-${String(i).padStart(6, '0')}`,
        index: i,
        timeMs,
        timeSec: timeMs / 1000,
        path: join(outputDir, files[i]!)
      })
    }
  } else {
    for (let i = 0; i < timestamps.length; i += 1) {
      const timeSec = timestamps[i]!
      const fileName = `frame_${String(i + 1).padStart(6, '0')}.${ext}`
      const outputPath = join(outputDir, fileName)
      const args = buildExtractFrameArgs({
        inputPath,
        outputPath,
        timeSec,
        format,
        quality,
        maxWidth
      })
      const result = await runTool(paths.ffmpegPath, args, { signal: options.signal })
      if (result.code !== 0) {
        throw new GvfError(
          'EXTRACT_FAILED',
          `ffmpeg frame extract failed at ${timeSec}s: ${result.stderr || `exit ${result.code}`}`
        )
      }
      const timeMs = Math.round(timeSec * 1000)
      frames.push({
        schema: SCHEMA_FRAME,
        id: `frame-${String(i).padStart(6, '0')}`,
        index: i,
        timeMs,
        timeSec,
        path: outputPath
      })
      options.onProgress?.(
        createProgressEvent('extract', i + 1, timestamps.length, fileName)
      )
    }
  }

  sampling = {
    ...sampling,
    count: frames.length,
    timestampBasis
  }
  if (options.maxOutputFrames != null && frames.length > options.maxOutputFrames) {
    throw new GvfError(
      'GUARD',
      `Actual output ${frames.length} frames exceeds --max-output-frames ${options.maxOutputFrames}.`,
      {
        details: { actualFrames: frames.length, maxOutputFrames: options.maxOutputFrames }
      }
    )
  }

  // Optional rename with template for non-candidate extracts
  if (!candidates && options.filenameTemplate) {
    const names = renderUniqueFrameFilenames(
      options.filenameTemplate,
      frames.map((f, index) => ({
        sourceStem: stem,
        index: index + 1,
        timeMs: f.timeMs
      }))
    )
    const { rename } = await import('node:fs/promises')
    for (let i = 0; i < frames.length; i += 1) {
      const next = join(outputDir, `${names[i]}.${ext}`)
      await rename(frames[i]!.path, next)
      frames[i] = { ...frames[i]!, path: next }
    }
  }

  let manifestPath: string
  let framesPath: string
  if (workspaceRoot) {
    await writeFrameRecords(workspaceRoot, frames)
    const manifest = await readManifest(workspaceRoot)
    await writeManifest(workspaceRoot, { ...manifest, sampling })
    const artifactPaths = workspacePaths(workspaceRoot)
    manifestPath = artifactPaths.manifest
    framesPath = artifactPaths.framesJsonl
  } else {
    manifestPath = join(outputDir, 'manifest.json')
    framesPath = join(outputDir, 'frames.jsonl')
    await atomicWriteFile(
      framesPath,
      frames.map((frame) => JSON.stringify(frame)).join('\n') +
        (frames.length ? '\n' : '')
    )
    await atomicWriteJson(manifestPath, {
      schema: 'gvf.extract-manifest/v1alpha1',
      createdAt: new Date().toISOString(),
      source: { path: inputPath, probe },
      sampling,
      format,
      quality,
      maxWidth,
      artifacts: {
        framesJsonl: 'frames.jsonl',
        framesDir: '.'
      },
      frameCount: frames.length
    })
  }

  options.onProgress?.(
    createProgressEvent('extract', frames.length, frames.length, 'done')
  )

  return {
    schema: 'gvf.result/v1alpha1',
    command: 'extract',
    workspace: workspaceRoot,
    outputDir,
    sampling,
    frames,
    manifestPath,
    framesPath
  }
}

export async function extractFramesBatch(inputs: string[], options: ExtractOptions = {}) {
  const results = []
  const folders = sourceSubdirectories(inputs)
  for (let index = 0; index < inputs.length; index += 1) {
    const isolate = inputs.length > 1
    const input = inputs[index]!
    results.push(
      await extractFrames(input, {
        ...options,
        output:
          isolate && options.output
            ? join(options.output, folders[index]!)
            : options.output,
        workspace:
          isolate && options.workspace
            ? join(options.workspace, folders[index]!)
            : options.workspace
      })
    )
  }
  return { schema: 'gvf.result/v1alpha1', command: 'extract', data: results }
}

export { workspacePaths }
