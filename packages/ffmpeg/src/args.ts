/**
 * Rotation-safe probe helpers and FFmpeg extract arg builders.
 * Adapted from GetVideoFrames Desktop probe.ts (owned pure logic).
 */

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export function buildFfprobeArgs(inputPath: string): string[] {
  return [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath
  ]
}

export function parseFps(rate?: string): number {
  if (!rate || rate === '0/0') return 0
  const parts = rate.split('/').map((v) => Number(v))
  const num = parts[0]
  const den = parts[1]
  if (!den || !Number.isFinite(num) || !Number.isFinite(den)) return 0
  return num / den
}

/**
 * Read display rotation from ffprobe stream tags / Display Matrix side data.
 * Phone MOVs often store landscape coded pixels with ±90° rotation.
 */
export function parseStreamRotation(stream: {
  tags?: Record<string, string>
  side_data_list?: Array<{ rotation?: number | string }>
}): number {
  for (const side of stream.side_data_list ?? []) {
    if (side.rotation == null || side.rotation === '') continue
    const value = Number(side.rotation)
    if (Number.isFinite(value)) return value
  }
  const tagged = stream.tags?.rotate
  if (tagged != null && tagged !== '') {
    const value = Number(tagged)
    if (Number.isFinite(value)) return value
  }
  return 0
}

/** Swap coded width/height when rotation is a quarter turn. */
export function displayDimensions(
  codedWidth: number,
  codedHeight: number,
  rotationDeg: number
): { width: number; height: number } {
  const normalized = ((Math.round(rotationDeg) % 360) + 360) % 360
  if (normalized === 90 || normalized === 270) {
    return { width: codedHeight, height: codedWidth }
  }
  return { width: codedWidth, height: codedHeight }
}

export function extensionForFormat(format: OutputFormat): string {
  switch (format) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default: {
      const _exhaustive: never = format
      return _exhaustive
    }
  }
}

export function buildExtractArgs(options: {
  inputPath: string
  outputPattern: string
  intervalSeconds: number
  format: OutputFormat
  quality: number
  maxWidth?: number
  rangeStartSec?: number
  rangeEndSec?: number
}): string[] {
  const {
    inputPath,
    outputPattern,
    intervalSeconds,
    format,
    quality,
    maxWidth,
    rangeStartSec,
    rangeEndSec
  } = options
  const args: string[] = ['-hide_banner', '-y']
  const start = Math.max(0, rangeStartSec ?? 0)
  if (start > 0) {
    args.push('-ss', String(start))
  }
  args.push('-i', inputPath)
  if (rangeEndSec != null && rangeEndSec > start) {
    args.push('-t', String(rangeEndSec - start))
  }

  const filters: string[] = [`fps=1/${Math.max(0.05, intervalSeconds)}`]
  if (maxWidth && maxWidth > 0) {
    filters.push(`scale='min(${maxWidth},iw)':-2`)
  }
  args.push('-vf', filters.join(','))

  if (format === 'image/jpeg') {
    const q = Math.round((1 - Math.min(1, Math.max(0, quality))) * 31)
    args.push('-q:v', String(Math.min(31, Math.max(2, q))))
  } else if (format === 'image/webp') {
    args.push('-quality', String(Math.round(Math.min(1, Math.max(0, quality)) * 100)))
  }

  args.push(outputPattern)
  return args
}

/** Extract every decoded source frame without FPS resampling (VFR-safe). */
export function buildAllFramesArgs(options: {
  inputPath: string
  outputPattern: string
  format: OutputFormat
  quality: number
  maxWidth?: number
  rangeStartSec?: number
  rangeEndSec?: number
  maxFrames?: number
}): string[] {
  const args: string[] = ['-hide_banner', '-y']
  const start = options.rangeStartSec ?? 0
  if (start > 0) args.push('-ss', String(start))
  args.push('-i', options.inputPath)
  if (options.rangeEndSec != null) {
    args.push('-t', String(options.rangeEndSec - start))
  }
  if (options.maxWidth != null) {
    args.push('-vf', `scale='min(${options.maxWidth},iw)':-2`)
  }
  args.push('-fps_mode', 'passthrough')
  if (options.maxFrames != null) {
    args.push('-frames:v', String(options.maxFrames))
  }
  if (options.format === 'image/jpeg') {
    const q = Math.round((1 - options.quality) * 31)
    args.push('-q:v', String(Math.min(31, Math.max(2, q))))
  } else if (options.format === 'image/webp') {
    args.push('-quality', String(Math.round(options.quality * 100)))
  }
  args.push(options.outputPattern)
  return args
}

export function buildExtractFrameArgs(options: {
  inputPath: string
  outputPath: string
  timeSec: number
  format: OutputFormat
  quality: number
  maxWidth?: number
}): string[] {
  const args = [
    '-hide_banner',
    '-y',
    '-ss',
    String(Math.max(0, options.timeSec)),
    '-i',
    options.inputPath,
    '-frames:v',
    '1'
  ]
  if (options.maxWidth && options.maxWidth > 0) {
    args.push('-vf', `scale='min(${options.maxWidth},iw)':-2`)
  }
  if (options.format === 'image/jpeg') {
    const q = Math.round((1 - Math.min(1, Math.max(0, options.quality))) * 31)
    args.push('-q:v', String(Math.min(31, Math.max(2, q))))
  } else if (options.format === 'image/webp') {
    args.push(
      '-quality',
      String(Math.round(Math.min(1, Math.max(0, options.quality)) * 100))
    )
  }
  args.push(options.outputPath)
  return args
}

/** Decode a candidate image sequence to raw RGB for analysis. */
export function buildAnalysisDecodeArgs(
  inputPattern: string,
  width: number,
  height: number
): string[] {
  return [
    '-v',
    'error',
    '-framerate',
    '1',
    '-i',
    inputPattern,
    '-vf',
    `scale=${width}:${height}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1'
  ]
}

/**
 * Letterbox a single frame for YOLOX (416×416, gray pad).
 * Top-left aligned pad matches YOLOX export expectations and Desktop decode.
 */
export function buildYoloxDecodeArgs(
  inputPath: string,
  inputSize: number,
  padColor = '0x727272'
): string[] {
  return [
    '-v',
    'error',
    '-i',
    inputPath,
    '-vf',
    `scale=${inputSize}:${inputSize}:force_original_aspect_ratio=decrease,pad=${inputSize}:${inputSize}:0:0:color=${padColor}`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1'
  ]
}

export function buildSelectTimestampsFilter(timestampsSec: readonly number[]): string {
  // select='eq(t\,1.5)+eq(t\,3.0)' style — values are numbers we control
  const clauses = timestampsSec.map((t) => `eq(t\\,${t.toFixed(3)})`)
  return `select='${clauses.join('+')}'`
}
