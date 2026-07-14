import { runTool } from './process.js'

export function buildFrameTimestampProbeArgs(options: {
  inputPath: string
  fromSec?: number
  toSec?: number
}): string[] {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'frame=best_effort_timestamp_time',
    '-of',
    'json'
  ]
  if (options.fromSec != null || options.toSec != null) {
    args.push('-read_intervals', `${options.fromSec ?? 0}%${options.toSec ?? ''}`)
  }
  args.push(options.inputPath)
  return args
}

export function parseFrameTimestamps(output: string): number[] {
  const parsed = JSON.parse(output) as {
    frames?: Array<{ best_effort_timestamp_time?: string | number }>
  }
  return (parsed.frames ?? [])
    .map((frame) => Number(frame.best_effort_timestamp_time))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= 0)
}

export async function probeFrameTimestamps(options: {
  ffprobePath: string
  inputPath: string
  fromSec?: number
  toSec?: number
  estimatedFrames: number
  signal?: AbortSignal
}): Promise<number[]> {
  const maxBuffer = Math.min(
    256 * 1024 * 1024,
    Math.max(1024 * 1024, options.estimatedFrames * 128)
  )
  const result = await runTool(
    options.ffprobePath,
    buildFrameTimestampProbeArgs(options),
    { signal: options.signal, maxBuffer }
  )
  if (result.code !== 0) {
    throw new Error(`ffprobe frame timestamps failed: ${result.stderr || result.code}`)
  }
  return parseFrameTimestamps(result.stdout)
}
