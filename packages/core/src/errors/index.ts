/**
 * Normalized GVF errors and stable CLI/MCP exit codes.
 */

export const ExitCodes = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  FFMPEG: 4,
  VISION: 5,
  CANCELLED: 6,
  GUARD: 7,
  IO: 8
} as const

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes]

export type GvfErrorCode =
  | 'USAGE'
  | 'NOT_FOUND'
  | 'FFMPEG_NOT_FOUND'
  | 'VISION_NOT_READY'
  | 'TEXT_VISION_BLOCKED'
  | 'CANCELLED'
  | 'GUARD'
  | 'IO'
  | 'PROBE_FAILED'
  | 'EXTRACT_FAILED'
  | 'ANALYZE_FAILED'
  | 'DETECT_FAILED'
  | 'SELECT_FAILED'
  | 'EXPORT_FAILED'
  | 'INTERNAL'

export class GvfError extends Error {
  readonly code: GvfErrorCode
  readonly exitCode: ExitCode
  readonly hint?: string
  readonly details?: Record<string, unknown>

  constructor(
    code: GvfErrorCode,
    message: string,
    options?: {
      exitCode?: ExitCode
      hint?: string
      details?: Record<string, unknown>
      cause?: unknown
    }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'GvfError'
    this.code = code
    this.exitCode =
      options?.exitCode ??
      (code === 'USAGE'
        ? ExitCodes.USAGE
        : code === 'NOT_FOUND'
          ? ExitCodes.NOT_FOUND
          : code === 'FFMPEG_NOT_FOUND'
            ? ExitCodes.FFMPEG
            : code === 'VISION_NOT_READY' || code === 'TEXT_VISION_BLOCKED'
              ? ExitCodes.VISION
              : code === 'CANCELLED'
                ? ExitCodes.CANCELLED
                : code === 'GUARD'
                  ? ExitCodes.GUARD
                  : code === 'IO'
                    ? ExitCodes.IO
                    : ExitCodes.GENERIC)
    this.hint = options?.hint
    this.details = options?.details
  }

  toJSON(): Record<string, unknown> {
    return {
      schema: 'gvf.error/v1alpha1',
      code: this.code,
      message: this.message,
      hint: this.hint,
      details: this.details,
      exitCode: this.exitCode
    }
  }
}

export function isGvfError(error: unknown): error is GvfError {
  return error instanceof GvfError
}

export function toGvfError(error: unknown): GvfError {
  if (error instanceof GvfError) return error
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name: string }).name)
    const message = error instanceof Error ? error.message : String(error)
    const hint =
      'hint' in error && typeof (error as { hint: unknown }).hint === 'string'
        ? (error as { hint: string }).hint
        : undefined
    if (
      name === 'CommanderError' ||
      name === 'InvalidArgumentError' ||
      name === 'ZodError'
    ) {
      return new GvfError('USAGE', message, { hint, exitCode: ExitCodes.USAGE })
    }
    if (name === 'FFmpegNotFoundError') {
      return new GvfError('FFMPEG_NOT_FOUND', message, {
        hint,
        exitCode: ExitCodes.FFMPEG
      })
    }
    if (name === 'VisionNotReadyError') {
      return new GvfError('VISION_NOT_READY', message, {
        hint,
        exitCode: ExitCodes.VISION
      })
    }
    if (name === 'TextVisionBlockedError') {
      return new GvfError('TEXT_VISION_BLOCKED', message, {
        hint,
        exitCode: ExitCodes.VISION
      })
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new GvfError('CANCELLED', 'Operation cancelled.', {
      exitCode: ExitCodes.CANCELLED
    })
  }
  return new GvfError(
    'INTERNAL',
    error instanceof Error ? error.message : String(error),
    {
      cause: error
    }
  )
}
