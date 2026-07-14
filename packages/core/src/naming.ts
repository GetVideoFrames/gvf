/** Output filename templating for exported frames. */

export const DEFAULT_FILENAME_TEMPLATE = '{source}_frame_{index}'

export const FILENAME_TOKENS = [
  '{source}',
  '{index}',
  '{time}',
  '{ms}',
  '{scene}',
  '{date}'
] as const

export interface FrameNameContext {
  /** Source video name without extension. */
  sourceStem: string
  /** 1-based export position. */
  index: number
  timeMs: number
  sceneIndex?: number
  /** Export date, defaults to today. */
  date?: Date
}

function sanitizeComponent(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function timestampToken(timeMs: number): string {
  const totalSeconds = Math.max(0, timeMs) / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}m${seconds
    .toFixed(2)
    .padStart(5, '0')
    .replace('.', 's')}`
}

function dateToken(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Render a filename (without extension) from a user template.
 * Unknown tokens are left literal; the result is filesystem-safe and never
 * empty — a blank template falls back to the default.
 */
export function renderFrameFilename(
  template: string | undefined,
  context: FrameNameContext
): string {
  const pattern =
    typeof template === 'string' && template.trim()
      ? template.trim()
      : DEFAULT_FILENAME_TEMPLATE
  const rendered = pattern
    .replaceAll('{source}', context.sourceStem)
    .replaceAll('{index}', String(context.index).padStart(4, '0'))
    .replaceAll('{time}', timestampToken(context.timeMs))
    .replaceAll('{ms}', String(Math.round(context.timeMs)))
    .replaceAll('{scene}', String((context.sceneIndex ?? 0) + 1).padStart(2, '0'))
    .replaceAll('{date}', dateToken(context.date ?? new Date()))
  const safe = sanitizeComponent(rendered)
  if (safe) return safe
  return sanitizeComponent(
    DEFAULT_FILENAME_TEMPLATE.replaceAll('{source}', context.sourceStem).replaceAll(
      '{index}',
      String(context.index).padStart(4, '0')
    )
  )
}

/**
 * Render unique filenames for a batch: identical rendered names get a
 * numeric suffix so exports never overwrite each other.
 */
export function renderUniqueFrameFilenames(
  template: string | undefined,
  contexts: readonly FrameNameContext[]
): string[] {
  const used = new Map<string, number>()
  return contexts.map((context) => {
    const base = renderFrameFilename(template, context)
    const key = base.toLowerCase()
    const seen = used.get(key) ?? 0
    used.set(key, seen + 1)
    return seen === 0 ? base : `${base}_${seen + 1}`
  })
}
