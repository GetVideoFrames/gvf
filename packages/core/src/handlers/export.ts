/**
 * HQ export — re-extract selected timestamps from source at final quality.
 */

import { basename, join } from 'node:path'
import {
  buildExtractFrameArgs,
  extensionForFormat,
  runTool,
  type OutputFormat
} from '@gvf/ffmpeg'
import { GvfError } from '../errors/index.js'
import { requireFFmpeg } from '../runtime/runtime.js'
import { createProgressEvent, type ProgressReporter } from '../runtime/progress.js'
import { renderUniqueFrameFilenames } from '../naming.js'
import { atomicWriteJson, readManifest, readSelections } from '../workspace/io.js'
import type { SelectionsFile } from '../schemas/v1alpha1.js'
import {
  OutputFormatSchema,
  parseUsage,
  PositiveIntegerSchema,
  validateUnitRange
} from '../validation/options.js'
import { guardOutputDirectory } from '../io/output.js'
import { canonicalSourcePath } from '../source.js'

export interface ExportOptions {
  selection: string
  output: string
  format?: OutputFormat
  quality?: number
  maxWidth?: number
  filenameTemplate?: string
  includeManifest?: boolean
  workspace?: string
  overwrite?: boolean
  signal?: AbortSignal
  ffmpegPath?: string
  ffprobePath?: string
  onProgress?: ProgressReporter
}

export async function exportFrames(
  inputPath: string,
  options: ExportOptions
): Promise<{
  schema: 'gvf.result/v1alpha1'
  command: 'export'
  outputDir: string
  exported: Array<{ frameId: string; timeSec: number; path: string }>
  manifestPath?: string
}> {
  inputPath = canonicalSourcePath(inputPath)
  if (!options.selection) {
    throw new GvfError('USAGE', 'export requires --selection FILE')
  }
  if (!options.output) {
    throw new GvfError('USAGE', 'export requires --output DIR')
  }
  const format = parseUsage(
    OutputFormatSchema,
    options.format ?? 'image/jpeg',
    'output format'
  )
  const quality = validateUnitRange(options.quality ?? 0.92, '--quality')!
  if (options.maxWidth != null) {
    parseUsage(PositiveIntegerSchema, options.maxWidth, '--max-width')
  }

  let selections: SelectionsFile
  try {
    selections = await readSelections(options.selection, true)
  } catch {
    // try as workspace root
    selections = await readSelections(options.selection, false)
  }

  if (selections.selections.length === 0) {
    throw new GvfError('EXPORT_FAILED', 'Selection file has no frames.')
  }

  let sourcePath = inputPath
  if (options.workspace) {
    const manifest = await readManifest(options.workspace)
    sourcePath = manifest.source.path
  }
  const requestedSource = canonicalSourcePath(inputPath)
  const workspaceSource = canonicalSourcePath(sourcePath)
  const selectionSource = selections.sourcePath
    ? canonicalSourcePath(selections.sourcePath)
    : undefined
  if (
    requestedSource !== workspaceSource ||
    (selectionSource != null && selectionSource !== requestedSource)
  ) {
    throw new GvfError(
      'EXPORT_FAILED',
      'Selection/workspace source does not match the requested input video.',
      {
        hint: 'Use selections.json and workspace artifacts created for this exact source file.',
        details: { requestedSource, workspaceSource, selectionSource }
      }
    )
  }

  const ext = extensionForFormat(format)
  const outputDir = options.output
  await guardOutputDirectory(outputDir, options.overwrite)

  const stem = basename(sourcePath).replace(/\.[^.]+$/, '')
  const names = renderUniqueFrameFilenames(
    options.filenameTemplate,
    selections.selections.map((s, index) => ({
      sourceStem: stem,
      index: index + 1,
      timeMs: s.timeMs
    }))
  )

  const paths = await requireFFmpeg({
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath
  })

  const exported: Array<{ frameId: string; timeSec: number; path: string }> = []

  for (let i = 0; i < selections.selections.length; i += 1) {
    const sel = selections.selections[i]!
    options.onProgress?.(
      createProgressEvent('export', i, selections.selections.length, sel.frameId)
    )
    const outPath = join(outputDir, `${names[i]}.${ext}`)
    const args = buildExtractFrameArgs({
      inputPath: sourcePath,
      outputPath: outPath,
      timeSec: sel.timeSec,
      format,
      quality,
      maxWidth: options.maxWidth
    })
    const result = await runTool(paths.ffmpegPath, args, { signal: options.signal })
    if (result.code !== 0) {
      throw new GvfError(
        'EXPORT_FAILED',
        `ffmpeg export failed at ${sel.timeSec}s: ${result.stderr || `exit ${result.code}`}`
      )
    }
    exported.push({ frameId: sel.frameId, timeSec: sel.timeSec, path: outPath })
  }

  let manifestPath: string | undefined
  if (options.includeManifest !== false) {
    manifestPath = join(outputDir, 'manifest.json')
    await atomicWriteJson(manifestPath, {
      schema: 'gvf.export-manifest/v1alpha1',
      source: sourcePath,
      format,
      quality,
      exported,
      selections: selections.selections,
      createdAt: new Date().toISOString()
    })
  }

  options.onProgress?.(
    createProgressEvent('export', exported.length, exported.length, 'done')
  )

  return {
    schema: 'gvf.result/v1alpha1',
    command: 'export',
    outputDir,
    exported,
    manifestPath
  }
}
