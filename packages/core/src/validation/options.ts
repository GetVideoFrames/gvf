import { z } from 'zod/v4'
import { GvfError } from '../errors/index.js'

export const OutputFormatSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])
export const RankModeSchema = z.enum(['quality', 'sharpness', 'exposure'])
export const UnitIntervalSchema = z.number().finite().min(0).max(1)
export const DetectionConfidenceSchema = z.number().finite().min(0.01).max(1)
export const PositiveFiniteSchema = z.number().finite().positive()
export const PositiveIntegerSchema = z.number().int().positive()

export function parseUsage<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new GvfError('USAGE', `Invalid ${label}: ${z.prettifyError(result.error)}`, {
      details: { label, issues: result.error.issues }
    })
  }
  return result.data
}

export function validateRange(from: number | undefined, to: number | undefined): void {
  if (from != null) parseUsage(z.number().finite().nonnegative(), from, '--from')
  if (to != null) parseUsage(z.number().finite().positive(), to, '--to')
  if (from != null && to != null && to <= from) {
    throw new GvfError('USAGE', '--to must be greater than --from.')
  }
}

export function validateUnitRange(
  value: number | undefined,
  label: string
): number | undefined {
  return value == null ? undefined : parseUsage(UnitIntervalSchema, value, label)
}
