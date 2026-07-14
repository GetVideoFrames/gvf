/**
 * Flagship pipeline: analyze/detect as needed → select → HQ export.
 */

import { createProgressEvent, type ProgressReporter } from '../runtime/progress.js'
import type { SelectOptions } from '../selection/select.js'
import { selectFrames } from './select.js'
import { exportFrames } from './export.js'
import type { OutputFormat } from '@gvf/ffmpeg'
import { join } from 'node:path'
import { sourceSubdirectories } from '../io/output.js'

export interface RunOptions extends SelectOptions {
  export?: string
  format?: OutputFormat
  quality?: number
  maxWidth?: number
  filenameTemplate?: string
  overwrite?: boolean
  preset?: string
  workspace?: string
  every?: number
  fps?: number
  count?: number
  at?: number[]
  all?: boolean
  from?: number
  to?: number
  budget?: number
  concurrency?: number
  signal?: AbortSignal
  ffmpegPath?: string
  ffprobePath?: string
  modelsDir?: string
  onProgress?: ProgressReporter
  interactive?: boolean
  confirmVisionSetup?: (plan: unknown) => Promise<boolean>
}

export async function runPipeline(
  input: string,
  options: RunOptions = {}
): Promise<{
  schema: 'gvf.result/v1alpha1'
  command: 'run'
  workspace: string
  selectionsPath: string
  selectionCount: number
  export?: {
    outputDir: string
    exportedCount: number
    manifestPath?: string
  }
}> {
  options.onProgress?.(createProgressEvent('run', 0, 2, 'select'))

  const selected = await selectFrames(input, {
    ...options,
    analyze: true,
    detect: true
  })

  options.onProgress?.(createProgressEvent('run', 1, 2, 'export'))

  let exportResult:
    | {
        outputDir: string
        exportedCount: number
        manifestPath?: string
      }
    | undefined

  if (options.export) {
    const exported = await exportFrames(input, {
      selection: selected.selectionsPath,
      output: options.export,
      format: options.format,
      quality: options.quality,
      maxWidth: options.maxWidth,
      filenameTemplate: options.filenameTemplate,
      overwrite: options.overwrite,
      workspace: selected.workspace,
      signal: options.signal,
      ffmpegPath: options.ffmpegPath,
      ffprobePath: options.ffprobePath,
      onProgress: options.onProgress
    })
    exportResult = {
      outputDir: exported.outputDir,
      exportedCount: exported.exported.length,
      manifestPath: exported.manifestPath
    }
  }

  options.onProgress?.(createProgressEvent('run', 2, 2, 'done'))

  return {
    schema: 'gvf.result/v1alpha1',
    command: 'run',
    workspace: selected.workspace,
    selectionsPath: selected.selectionsPath,
    selectionCount: selected.selections.selections.length,
    export: exportResult
  }
}

export async function runPipelineBatch(
  inputs: string[],
  options: RunOptions = {}
): Promise<{
  schema: 'gvf.result/v1alpha1'
  command: 'run'
  data: Awaited<ReturnType<typeof runPipeline>>[]
}> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 4))
  const data: Awaited<ReturnType<typeof runPipeline>>[] = []
  const folders = sourceSubdirectories(inputs)
  const optionsFor = (index: number): RunOptions => ({
    ...options,
    workspace:
      inputs.length > 1 && options.workspace
        ? join(options.workspace, folders[index]!)
        : options.workspace,
    export:
      inputs.length > 1 && options.export
        ? join(options.export, folders[index]!)
        : options.export
  })

  if (concurrency === 1) {
    for (let index = 0; index < inputs.length; index += 1) {
      data.push(await runPipeline(inputs[index]!, optionsFor(index)))
    }
  } else {
    let index = 0
    const workers = Array.from({ length: concurrency }, async () => {
      while (index < inputs.length) {
        const current = index
        index += 1
        const input = inputs[current]!
        const result = await runPipeline(input, {
          ...optionsFor(current)
        })
        data[current] = result
      }
    })
    await Promise.all(workers)
  }

  return { schema: 'gvf.result/v1alpha1', command: 'run', data }
}
