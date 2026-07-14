/**
 * FFmpeg resolution: explicit flags/env → system PATH → managed sidecar fallback.
 * Optional guided setup never packages binaries into npm.
 */

import { access, constants } from 'node:fs'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { z } from 'zod/v4'
import { inspectManagedFfmpeg, SETUP_HINT } from './setup.js'

const accessAsync = promisify(access)
const execFileAsync = promisify(execFile)

export const ResolvedFFmpegPathsSchema = z.object({
  ffmpegPath: z.string().min(1),
  ffprobePath: z.string().min(1),
  source: z.enum(['explicit', 'env', 'managed', 'path']),
  version: z.string().optional()
})

export type ResolvedFFmpegPaths = z.infer<typeof ResolvedFFmpegPathsSchema>

export class FFmpegNotFoundError extends Error {
  readonly code = 'FFMPEG_NOT_FOUND'
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'FFmpegNotFoundError'
    this.hint = hint
  }
}

export { SETUP_HINT }
async function isExecutable(path: string): Promise<boolean> {
  try {
    await accessAsync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function siblingProbePath(ffmpegPath: string): string {
  const dir = dirname(ffmpegPath)
  const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  return join(dir, name)
}

async function which(command: string): Promise<string | undefined> {
  try {
    const bin = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(bin, [command], { encoding: 'utf8' })
    const first = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean)
    return first
  } catch {
    return undefined
  }
}

async function readVersion(ffmpegPath: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(ffmpegPath, ['-version'], {
      encoding: 'utf8'
    })
    const line = (stdout || stderr).split('\n')[0]?.trim()
    return line
  } catch {
    return undefined
  }
}

export interface ResolveFFmpegOptions {
  ffmpegPath?: string
  ffprobePath?: string
}

export type FFmpegResolutionCandidate = 'explicit' | 'env' | 'path' | 'managed'

/** Pure, deterministic policy used by the resolver and unit tests. */
export function ffmpegResolutionOrder(
  options: {
    explicit?: boolean
    env?: boolean
  } = {}
): FFmpegResolutionCandidate[] {
  return [
    ...(options.explicit ? (['explicit'] as const) : []),
    ...(options.env ? (['env'] as const) : []),
    'path',
    'managed'
  ]
}

export async function resolveFFmpeg(
  options: ResolveFFmpegOptions = {}
): Promise<ResolvedFFmpegPaths> {
  const envFfmpeg = process.env.GVF_FFMPEG_PATH?.trim()
  const envFfprobe = process.env.GVF_FFPROBE_PATH?.trim()

  let ffmpegPath = options.ffmpegPath?.trim() || envFfmpeg
  let ffprobePath = options.ffprobePath?.trim() || envFfprobe
  let source: ResolvedFFmpegPaths['source'] =
    options.ffmpegPath || options.ffprobePath
      ? 'explicit'
      : envFfmpeg || envFfprobe
        ? 'env'
        : 'path'

  if (!ffmpegPath) {
    const systemFfmpeg = await which(
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    )
    const systemFfprobe = await which(
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    )
    if (systemFfmpeg && (ffprobePath || systemFfprobe)) {
      ffmpegPath = systemFfmpeg
      ffprobePath = ffprobePath || systemFfprobe
      if (source !== 'explicit' && source !== 'env') source = 'path'
    }
  }
  if (!ffmpegPath) {
    const managed = await inspectManagedFfmpeg()
    if (managed.ok && managed.ffmpegPath && managed.ffprobePath) {
      ffmpegPath = managed.ffmpegPath
      ffprobePath = ffprobePath || managed.ffprobePath
      if (source !== 'explicit' && source !== 'env') source = 'managed'
    }
  }
  if (!ffprobePath && ffmpegPath) {
    ffprobePath = siblingProbePath(ffmpegPath)
    if (!(await isExecutable(ffprobePath))) {
      ffprobePath = await which(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    }
  }

  if (!ffmpegPath || !ffprobePath) {
    throw new FFmpegNotFoundError('FFmpeg/ffprobe not found.', SETUP_HINT)
  }

  if (!(await isExecutable(ffmpegPath)) || !(await isExecutable(ffprobePath))) {
    throw new FFmpegNotFoundError('FFmpeg/ffprobe path is not executable.', SETUP_HINT)
  }

  const version = await readVersion(ffmpegPath)
  return ResolvedFFmpegPathsSchema.parse({
    ffmpegPath,
    ffprobePath,
    source,
    version
  })
}

export async function inspectFFmpeg(options: ResolveFFmpegOptions = {}): Promise<{
  ok: boolean
  paths?: ResolvedFFmpegPaths
  error?: string
  hint: string
}> {
  try {
    const paths = await resolveFFmpeg(options)
    return { ok: true, paths, hint: 'FFmpeg is ready.' }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      hint: error instanceof FFmpegNotFoundError ? error.hint : SETUP_HINT
    }
  }
}
