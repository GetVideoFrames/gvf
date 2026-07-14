/**
 * GVF CLI — machine-readable JSON on stdout, progress/logs on stderr.
 */

import { Command } from 'commander'
import {
  ExitCodes,
  GvfError,
  inspectRuntime,
  setupRuntime,
  probeVideos,
  extractFramesBatch,
  analyzeFrames,
  detectFrames,
  selectFrames,
  exportFrames,
  runPipelineBatch,
  stderrJsonlProgress,
  toGvfError,
  GVF_PRESETS,
  type SelectOptions
} from '@gvf/core'
import { createInterface } from 'node:readline'

function isTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

function writeResult(value: unknown, pretty: boolean): void {
  process.stdout.write(
    pretty ? JSON.stringify(value, null, 2) + '\n' : JSON.stringify(value) + '\n'
  )
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close()
      resolve(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

async function confirmVisionSetup(plan: unknown): Promise<boolean> {
  process.stderr.write(
    JSON.stringify(
      { schema: 'gvf.vision-setup-plan/v1alpha1', ...(plan as object) },
      null,
      2
    ) + '\n'
  )
  return confirm('Download and install this verified external model?')
}

async function confirmFfmpegSetup(plan: unknown): Promise<boolean> {
  process.stderr.write(JSON.stringify(plan, null, 2) + '\n')
  return confirm(
    'Download and install this verified external FFmpeg sidecar? (runtime management, not MIT GVF code)'
  )
}

function outputFormat(value: unknown): 'image/jpeg' | 'image/png' | 'image/webp' {
  const format = String(value ?? 'jpeg').toLowerCase()
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  throw new GvfError('USAGE', `Invalid --format "${format}". Use jpeg, png, or webp.`)
}

function samplingFromOpts(opts: Record<string, unknown>) {
  const at = opts.at
    ? (Array.isArray(opts.at) ? opts.at : [opts.at]).map(Number)
    : undefined
  return {
    every: opts.every != null ? Number(opts.every) : undefined,
    fps: opts.fps != null ? Number(opts.fps) : undefined,
    count: opts.count != null ? Number(opts.count) : undefined,
    at,
    all: Boolean(opts.all),
    from: opts.from != null ? Number(opts.from) : undefined,
    to: opts.to != null ? Number(opts.to) : undefined,
    budget: opts.budget != null ? Number(opts.budget) : undefined
  }
}

export function selectFromOpts(opts: Record<string, unknown>): SelectOptions {
  const withValues = asStringArray(opts.with)
  const withAnyValues = asStringArray(opts.withAny)
  const withoutValues = asStringArray(opts.without)
  return {
    with: withValues?.length ? withValues : undefined,
    withAny: withAnyValues?.length ? withAnyValues : undefined,
    without: withoutValues?.length ? withoutValues : undefined,
    withText: opts.withText ? true : undefined,
    withoutText: opts.withoutText ? true : undefined,
    minTextCoverage:
      opts.minTextCoverage != null ? Number(opts.minTextCoverage) : undefined,
    maxTextCoverage:
      opts.maxTextCoverage != null ? Number(opts.maxTextCoverage) : undefined,
    minConfidence: opts.minConfidence != null ? Number(opts.minConfidence) : undefined,
    minQuality: opts.minQuality != null ? Number(opts.minQuality) : undefined,
    rank: opts.rank as SelectOptions['rank'],
    dedupe: opts.dedupe ? true : undefined,
    bestPerScene: opts.bestPerScene != null ? Number(opts.bestPerScene) : undefined,
    limit: opts.limit != null ? Number(opts.limit) : undefined
  }
}

export function boundedFrames(
  frames: Array<{ id: string; timeSec: number; path: string }>,
  limit = 20
) {
  return {
    count: frames.length,
    sample: frames.slice(0, limit).map(({ id, timeSec, path }) => ({
      id,
      timeSec,
      path
    }))
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined
  if (Array.isArray(value)) return value.map(String)
  return [String(value)]
}

function addSamplingOptions(cmd: Command): Command {
  return cmd
    .option('--every <seconds>', 'Sample every N seconds')
    .option('--fps <fps>', 'Sample at N frames per second')
    .option('--count <n>', 'Sample N frames across the range')
    .option(
      '--at <sec>',
      'Sample at timestamp (repeatable)',
      (v, acc: string[]) => {
        acc.push(v)
        return acc
      },
      [] as string[]
    )
    .option('--all', 'Sample all frames (subject to budget / guards)')
    .option('--from <sec>', 'Range start seconds')
    .option('--to <sec>', 'Range end seconds')
    .option('--budget <n>', 'Max candidate frames (default 1200)')
}

function addSelectOptions(cmd: Command): Command {
  return cmd
    .option('--with <class>', 'Require class/group (repeatable)', collect, [])
    .option('--with-any <class>', 'Require any of (repeatable)', collect, [])
    .option('--without <class>', 'Exclude class/group (repeatable)', collect, [])
    .option('--with-text', 'Require text presence')
    .option('--without-text', 'Exclude frames with text')
    .option('--min-text-coverage <n>', 'Min text coverage 0–1')
    .option('--max-text-coverage <n>', 'Max text coverage 0–1')
    .option('--min-confidence <n>', 'Detection confidence threshold 0.01–1')
    .option('--min-quality <n>', 'Min composite quality score')
    .option('--rank <mode>', 'quality|sharpness|exposure')
    .option('--dedupe', 'Drop perceptual duplicates')
    .option('--best-per-scene <n>', 'Keep top N per scene')
    .option('--limit <n>', 'Limit selection count')
    .option('--preset <id>', `Preset: ${Object.keys(GVF_PRESETS).join('|')}`)
}

function collect(value: string, acc: string[]): string[] {
  acc.push(value)
  return acc
}

function addGlobalOptions(cmd: Command): Command {
  return cmd
    .option('--pretty', 'Pretty-print JSON on stdout')
    .option('--ffmpeg <path>', 'Explicit ffmpeg binary')
    .option('--ffprobe <path>', 'Explicit ffprobe binary')
    .option('--models-dir <dir>', 'Vision model directory (or GVF_MODELS_DIR)')
}

export function commandOptions(command: Command): ReturnType<Command['optsWithGlobals']> {
  return command.optsWithGlobals()
}

export async function runCli(argv: string[]): Promise<number> {
  const program = new Command()
  program
    .name('gvf')
    .description('GVF — Open-source video frame intelligence')
    .version('0.1.0')
    .exitOverride()

  addGlobalOptions(program)

  const doctor = program
    .command('doctor')
    .description('Inspect FFmpeg and vision runtime status')
  addGlobalOptions(doctor)
  doctor.action(async (_args, cmd) => {
    const opts = commandOptions(cmd)
    const status = await inspectRuntime({
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      modelsDir: opts.modelsDir
    })
    writeResult(status, Boolean(opts.pretty))
  })

  program
    .command('setup')
    .description('Guided runtime setup')
    .argument('<target>', 'ffmpeg|vision')
    .option('--models-dir <dir>', 'Vision model directory (or GVF_MODELS_DIR)')
    .option('--only <id>', 'Install one model (v1: yolox-nano)')
    .option('--yes', 'Approve the displayed FFmpeg or vision setup plan')
    .action(async (target: string, _args, cmd) => {
      const opts = commandOptions(cmd)
      if (target !== 'ffmpeg' && target !== 'vision') {
        throw new GvfError('USAGE', 'setup target must be ffmpeg or vision')
      }
      const result = await setupRuntime(target, {
        interactive: isTty(),
        modelsDir: opts.modelsDir,
        only: opts.only,
        yes: Boolean(opts.yes),
        confirmVisionSetup,
        confirmFfmpegSetup,
        ffmpegPath: opts.ffmpeg,
        ffprobePath: opts.ffprobe
      })
      writeResult(result, Boolean(opts.pretty))
    })

  const probe = program
    .command('probe')
    .description('Probe video metadata')
    .argument('<inputs...>', 'Video files')
  addGlobalOptions(probe)
  probe.action(async (inputs: string[], _opts, cmd) => {
    const opts = commandOptions(cmd)
    const result = await probeVideos(inputs, {
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      onProgress: stderrJsonlProgress()
    })
    writeResult(result, Boolean(opts.pretty))
  })

  const extract = program
    .command('extract')
    .description('Deterministic frame extraction (final quality unless --candidates)')
    .argument('<inputs...>', 'Video files')
    .option('--output <dir>', 'Output directory')
    .option('--workspace <dir>', 'Workspace directory')
    .option('--format <fmt>', 'jpeg|png|webp', 'jpeg')
    .option('--quality <n>', 'Quality 0–1', '0.9')
    .option('--max-width <n>', 'Max width')
    .option('--filename-template <tpl>', 'Filename template')
    .option('--candidates', 'Write low-res candidate workspace')
    .option('--force', 'Skip --all interactive guard')
    .option('--overwrite', 'Replace GVF frame targets; preserve unrelated files')
    .option('--max-output-frames <n>', 'Hard cap on output frames')
  addSamplingOptions(extract)
  addGlobalOptions(extract)
  extract.action(async (inputs: string[], _opts, cmd) => {
    const opts = commandOptions(cmd)
    const result = await extractFramesBatch(inputs, {
      ...samplingFromOpts(opts),
      output: opts.output,
      workspace: opts.workspace,
      format: outputFormat(opts.format),
      quality: Number(opts.quality),
      maxWidth: opts.maxWidth != null ? Number(opts.maxWidth) : undefined,
      filenameTemplate: opts.filenameTemplate,
      candidates: Boolean(opts.candidates) || !opts.output,
      force: Boolean(opts.force),
      overwrite: Boolean(opts.overwrite),
      maxOutputFrames:
        opts.maxOutputFrames != null ? Number(opts.maxOutputFrames) : undefined,
      interactive: isTty(),
      confirmAll: () =>
        confirm('This --all extract may create a large number of frames. Continue?'),
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      onProgress: stderrJsonlProgress()
    })
    writeResult(
      {
        schema: result.schema,
        command: result.command,
        data: result.data.map((item) => ({
          workspace: item.workspace,
          outputDir: item.outputDir,
          sampling: item.sampling,
          manifestPath: item.manifestPath,
          framesPath: item.framesPath,
          frames: boundedFrames(item.frames)
        }))
      },
      Boolean(opts.pretty)
    )
  })

  const analyze = program
    .command('analyze')
    .description('Analyze candidate frames (scene/sharpness/exposure/duplicates)')
    .argument('<input>', 'Source video file')
    .option('--workspace <dir>', 'Existing workspace')
  addSamplingOptions(analyze)
  addGlobalOptions(analyze)
  analyze.action(async (input: string, _opts, cmd) => {
    const opts = commandOptions(cmd)
    const result = await analyzeFrames(input, {
      workspace: opts.workspace,
      ...samplingFromOpts(opts),
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      onProgress: stderrJsonlProgress()
    })
    writeResult(
      {
        schema: result.schema,
        command: result.command,
        workspace: result.workspace,
        summary: result.summary,
        frameCount: result.frames.length
      },
      Boolean(opts.pretty)
    )
  })

  const detect = program
    .command('detect')
    .description('Detect objects on candidate frames')
    .argument('<input>', 'Video file')
    .option('--workspace <dir>', 'Existing workspace')
    .option('--object <class>', 'COCO class (repeatable)', collect, [])
    .option('--group <name>', 'people|animals|vehicles|products', collect, [])
    .option('--people', 'Alias for --group people')
    .option('--text', 'Text presence (blocked until provenance verified)')
    .option('--min-confidence <n>', 'Min confidence')
  addSamplingOptions(detect)
  addGlobalOptions(detect)
  detect.action(async (input: string, _opts, cmd) => {
    const opts = commandOptions(cmd)
    const result = await detectFrames(input, {
      workspace: opts.workspace,
      object: opts.object,
      group: opts.group,
      people: Boolean(opts.people),
      text: Boolean(opts.text),
      minConfidence: opts.minConfidence != null ? Number(opts.minConfidence) : undefined,
      modelsDir: opts.modelsDir,
      ...samplingFromOpts(opts),
      interactive: isTty(),
      confirmVisionSetup,
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      onProgress: stderrJsonlProgress()
    })
    writeResult(
      {
        schema: result.schema,
        command: result.command,
        workspace: result.workspace,
        summary: result.summary,
        frameCount: result.frames.length
      },
      Boolean(opts.pretty)
    )
  })

  const select = program
    .command('select')
    .description('Select frames into selections.json (no export)')
    .argument('<input>', 'Video file')
    .option('--workspace <dir>', 'Existing workspace')
  addSelectOptions(select)
  addSamplingOptions(select)
  addGlobalOptions(select)
  select.action(async (input: string, _opts, cmd) => {
    const opts = commandOptions(cmd)
    const result = await selectFrames(input, {
      workspace: opts.workspace,
      preset: opts.preset,
      ...selectFromOpts(opts),
      ...samplingFromOpts(opts),
      interactive: isTty(),
      confirmVisionSetup,
      modelsDir: opts.modelsDir,
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      onProgress: stderrJsonlProgress()
    })
    writeResult(
      {
        schema: result.schema,
        command: result.command,
        workspace: result.workspace,
        selectionsPath: result.selectionsPath,
        selectionCount: result.selections.selections.length,
        selections: result.selections.selections.slice(0, 20)
      },
      Boolean(opts.pretty)
    )
  })

  const exportCmd = program
    .command('export')
    .description('Re-extract selected timestamps at final quality')
    .argument('<input>', 'Source video')
    .requiredOption('--selection <file>', 'selections.json path')
    .requiredOption('--output <dir>', 'Output directory')
    .option('--format <fmt>', 'jpeg|png|webp', 'jpeg')
    .option('--quality <n>', 'Quality 0–1', '0.92')
    .option('--max-width <n>', 'Max width')
    .option('--filename-template <tpl>', 'Filename template')
    .option('--workspace <dir>', 'Workspace (source path from manifest)')
    .option('--overwrite', 'Replace exact export targets; preserve unrelated files')
  addGlobalOptions(exportCmd)
  exportCmd.action(async (input: string, _opts, cmd) => {
    const opts = commandOptions(cmd)
    const result = await exportFrames(input, {
      selection: opts.selection,
      output: opts.output,
      format: outputFormat(opts.format),
      quality: Number(opts.quality),
      maxWidth: opts.maxWidth != null ? Number(opts.maxWidth) : undefined,
      filenameTemplate: opts.filenameTemplate,
      workspace: opts.workspace,
      overwrite: Boolean(opts.overwrite),
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      onProgress: stderrJsonlProgress()
    })
    writeResult(
      {
        schema: result.schema,
        command: result.command,
        outputDir: result.outputDir,
        exportedCount: result.exported.length,
        manifestPath: result.manifestPath,
        sample: result.exported.slice(0, 20)
      },
      Boolean(opts.pretty)
    )
  })

  const run = program
    .command('run')
    .description(
      'FLAGSHIP: analyze/detect → select → optional HQ export. Preferred high-level command.'
    )
    .argument('<inputs...>', 'Video files')
    .option('--workspace <dir>', 'Existing workspace (single input)')
    .option('--export <dir>', 'Export selected frames to directory')
    .option('--format <fmt>', 'jpeg|png|webp', 'jpeg')
    .option('--quality <n>', 'Export quality 0–1', '0.92')
    .option('--max-width <n>', 'Export max width')
    .option('--filename-template <tpl>', 'Export filename template')
    .option('--concurrency <n>', 'Batch concurrency (1–4)', '1')
    .option('--overwrite', 'Replace exact export targets; preserve unrelated files')
  addSelectOptions(run)
  addSamplingOptions(run)
  addGlobalOptions(run)
  run.action(async (inputs: string[], _opts, cmd) => {
    const opts = commandOptions(cmd)
    if (opts.workspace && inputs.length > 1) {
      throw new GvfError('USAGE', '--workspace can only be used with one run input.')
    }
    const result = await runPipelineBatch(inputs, {
      ...selectFromOpts(opts),
      ...samplingFromOpts(opts),
      preset: opts.preset,
      workspace: opts.workspace,
      export: opts.export,
      format: outputFormat(opts.format),
      quality: Number(opts.quality),
      maxWidth: opts.maxWidth != null ? Number(opts.maxWidth) : undefined,
      filenameTemplate: opts.filenameTemplate,
      concurrency: Number(opts.concurrency ?? 1),
      overwrite: Boolean(opts.overwrite),
      interactive: isTty(),
      confirmVisionSetup,
      modelsDir: opts.modelsDir,
      ffmpegPath: opts.ffmpeg,
      ffprobePath: opts.ffprobe,
      onProgress: stderrJsonlProgress()
    })
    writeResult(result, Boolean(opts.pretty))
  })

  try {
    await program.parseAsync(argv)
    return ExitCodes.OK
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'commander.helpDisplayed'
    ) {
      return ExitCodes.OK
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'commander.version'
    ) {
      return ExitCodes.OK
    }
    const gvf = toGvfError(error)
    process.stderr.write(JSON.stringify(gvf.toJSON()) + '\n')
    return gvf.exitCode
  }
}
