/**
 * Select frames — writes selections.json with timestamps and explainable reasons.
 * No implicit export.
 */

import { GvfError } from '../errors/index.js'
import { createProgressEvent, type ProgressReporter } from '../runtime/progress.js'
import {
  applyPreset,
  buildSelectionsFile,
  validateSelectOptions,
  type SelectOptions
} from '../selection/select.js'
import {
  readFrameRecords,
  readManifest,
  writeSelections,
  workspacePaths
} from '../workspace/io.js'
import { analyzeFrames, hasCompleteAnalysisMetrics } from './analyze.js'
import { canReuseDetections, detectFrames } from './detect.js'
import type { SelectionsFile } from '../schemas/v1alpha1.js'
import { canonicalSourcePath } from '../source.js'

export interface SelectHandlerOptions extends SelectOptions {
  workspace?: string
  preset?: string
  /** Ensure analyze before select when starting from a video. */
  analyze?: boolean
  /** Ensure detect when filters need detections. */
  detect?: boolean
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
  interactive?: boolean
  confirmVisionSetup?: (plan: unknown) => Promise<boolean>
}

function needsDetections(options: SelectOptions): boolean {
  return Boolean(
    options.with?.length ||
    options.withAny?.length ||
    options.without?.length ||
    options.withText ||
    options.withoutText ||
    options.minTextCoverage != null ||
    options.maxTextCoverage != null
  )
}

function needsText(options: SelectOptions): boolean {
  return Boolean(
    options.withText ||
    options.withoutText ||
    options.minTextCoverage != null ||
    options.maxTextCoverage != null
  )
}

export async function selectFrames(
  input: string,
  options: SelectHandlerOptions = {}
): Promise<{
  schema: 'gvf.result/v1alpha1'
  command: 'select'
  workspace: string
  selectionsPath: string
  selections: SelectionsFile
}> {
  input = canonicalSourcePath(input)
  options.onProgress?.(createProgressEvent('select', 0, 1, 'prepare'))

  let selectOpts: SelectOptions = { ...options }
  if (options.preset) {
    selectOpts = applyPreset(options.preset, selectOpts)
  }
  validateSelectOptions(selectOpts)

  if (needsText(selectOpts) && !options.workspace) {
    throw new GvfError(
      'TEXT_VISION_BLOCKED',
      'Text predicates require verified text analysis metadata; no verified text provider is available.',
      {
        hint: 'Do not infer “no text” from unanalyzed frames. See docs/PROVENANCE.md.'
      }
    )
  }

  if (options.workspace && needsText(selectOpts)) {
    const manifest = await readManifest(options.workspace)
    const frames = await readFrameRecords(options.workspace)
    if (
      manifest.providers?.vision?.textComplete !== true ||
      frames.length === 0 ||
      frames.some((frame) => frame.text == null)
    ) {
      throw new GvfError(
        'TEXT_VISION_BLOCKED',
        'Text predicates require every frame to contain metadata from a verified text provider.',
        {
          hint: 'Text detection is currently blocked pending provenance review. Unanalyzed is not “no text”.'
        }
      )
    }
  }

  let workspace = options.workspace
  const needsDetect = options.detect !== false && needsDetections(selectOpts)
  const objectNeed = Boolean(
    selectOpts.with?.length || selectOpts.withAny?.length || selectOpts.without?.length
  )

  if (workspace) {
    const manifest = await readManifest(workspace)
    if (canonicalSourcePath(manifest.source.path) !== input) {
      throw new GvfError(
        'SELECT_FAILED',
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
    const frames = await readFrameRecords(workspace)
    const metricsComplete = hasCompleteAnalysisMetrics(frames, {
      rank: selectOpts.rank ?? 'quality',
      dedupe: selectOpts.dedupe === true,
      bestPerScene: selectOpts.bestPerScene != null,
      minQuality: selectOpts.minQuality != null
    })
    if (!metricsComplete) {
      if (options.analyze === false) {
        throw new GvfError(
          'SELECT_FAILED',
          'Selection requires smart analysis metrics, but this workspace is extraction-only.',
          {
            hint: 'Run `gvf analyze` first or allow selection to analyze the workspace.',
            details: { workspace, rank: selectOpts.rank ?? 'quality' }
          }
        )
      }
      await analyzeFrames(input, {
        workspace,
        signal: options.signal,
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
        onProgress: options.onProgress
      })
    }
  }

  if (!workspace) {
    if (objectNeed && needsDetect) {
      const detected = await detectFrames(input, {
        analyze: options.analyze !== false,
        signal: options.signal,
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
        onProgress: options.onProgress,
        every: options.every,
        fps: options.fps,
        count: options.count,
        at: options.at,
        all: options.all,
        from: options.from,
        to: options.to,
        budget: options.budget,
        minConfidence: selectOpts.minConfidence,
        modelsDir: options.modelsDir,
        interactive: options.interactive,
        confirmVisionSetup: options.confirmVisionSetup
      })
      workspace = detected.workspace
    } else {
      const analyzed = await analyzeFrames(input, {
        signal: options.signal,
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
        onProgress: options.onProgress,
        every: options.every,
        fps: options.fps,
        count: options.count,
        at: options.at,
        all: options.all,
        from: options.from,
        to: options.to,
        budget: options.budget
      })
      workspace = analyzed.workspace
    }
  } else if (objectNeed && needsDetect) {
    // Empty detections can be a valid complete result; trust only explicit completeness.
    const manifest = await readManifest(workspace)
    const requestedThreshold = selectOpts.minConfidence ?? 0.4
    const canReuse =
      manifest.providers?.vision?.detectionsComplete === true &&
      canReuseDetections(
        manifest.providers.vision.detectionMinConfidence,
        requestedThreshold
      )
    if (!canReuse) {
      await detectFrames(input, {
        workspace,
        analyze: false,
        signal: options.signal,
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
        onProgress: options.onProgress,
        minConfidence: requestedThreshold,
        modelsDir: options.modelsDir,
        interactive: options.interactive,
        confirmVisionSetup: options.confirmVisionSetup
      })
    }
  }

  const frames = await readFrameRecords(workspace)
  if (frames.length === 0) {
    throw new GvfError('SELECT_FAILED', 'No frames available to select.', {
      details: { workspace }
    })
  }

  const manifest = await readManifest(workspace)
  const selections = buildSelectionsFile(frames, selectOpts, manifest.source.path)
  await writeSelections(workspace, selections)
  const selectionsPath = workspacePaths(workspace).selections

  options.onProgress?.(createProgressEvent('select', 1, 1, 'done'))

  return {
    schema: 'gvf.result/v1alpha1',
    command: 'select',
    workspace,
    selectionsPath,
    selections
  }
}
