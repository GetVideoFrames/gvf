/**
 * Candidate sampling plan: exactly one of every|fps|count|at|all,
 * with optional from/to. Default interval 0.5s, budget 1200.
 */

import { z } from 'zod/v4'
import {
  DEFAULT_CANDIDATE_BUDGET,
  DEFAULT_CANDIDATE_INTERVAL_SEC,
  SamplingPlanSchema,
  type SamplingPlan
} from '../schemas/v1alpha1.js'
import { GvfError } from '../errors/index.js'
import {
  parseUsage,
  PositiveFiniteSchema,
  PositiveIntegerSchema,
  validateRange
} from '../validation/options.js'

export interface SamplingInput {
  every?: number
  fps?: number
  count?: number
  at?: number[]
  all?: boolean
  from?: number
  to?: number
  /** Null disables budgeting for direct extraction. */
  budget?: number | null
  durationSec: number
  sourceFps?: number
}

function countModes(input: SamplingInput): number {
  let n = 0
  if (input.every != null) n += 1
  if (input.fps != null) n += 1
  if (input.count != null) n += 1
  if (input.at != null && input.at.length > 0) n += 1
  if (input.all) n += 1
  return n
}

export function buildSamplingPlan(input: SamplingInput): SamplingPlan {
  const modes = countModes(input)
  if (modes > 1) {
    throw new GvfError(
      'USAGE',
      'Specify exactly one of --every, --fps, --count, --at, or --all.'
    )
  }

  validateRange(input.from, input.to)
  const duration = parseUsage(
    z.number().finite().nonnegative(),
    input.durationSec,
    'duration'
  )
  if ((input.from ?? 0) >= duration) {
    throw new GvfError('USAGE', '--from must be before the source duration.', {
      details: { from: input.from ?? 0, durationSec: duration }
    })
  }
  const budget =
    input.budget === null
      ? null
      : parseUsage(
          PositiveIntegerSchema,
          input.budget ?? DEFAULT_CANDIDATE_BUDGET,
          '--budget'
        )
  const from = input.from ?? 0
  const to = Math.min(input.to ?? duration, duration)
  const range = Math.max(0, to - from)
  const applyBudget = (requested: number): { count: number; capped: boolean } => ({
    count: budget == null ? requested : Math.min(requested, budget),
    capped: budget != null && requested > budget
  })
  const intervalCount = (interval: number): number =>
    range <= 0 ? 0 : Math.max(1, Math.ceil(range / interval - 1e-10))

  if (modes === 0) {
    // Default: every 0.5s
    const requestedIntervalSec = DEFAULT_CANDIDATE_INTERVAL_SEC
    const uncapped = intervalCount(requestedIntervalSec)
    const { count, capped } = applyBudget(uncapped)
    const effectiveIntervalSec =
      capped && count > 0 ? range / count : requestedIntervalSec
    return SamplingPlanSchema.parse({
      strategy: 'every',
      requestedIntervalSec,
      effectiveIntervalSec: capped ? effectiveIntervalSec : requestedIntervalSec,
      fromSec: from,
      toSec: to,
      count,
      capped,
      budget,
      equalDensity: !capped
    })
  }

  if (input.at && input.at.length > 0) {
    const timestamps = [...new Set(input.at)]
      .map((t) => parseUsage(z.number().finite().nonnegative(), t, '--at'))
      .filter((t) => t >= from && t < to)
      .sort((a, b) => a - b)
    const { count, capped } = applyBudget(timestamps.length)
    const selected = timestamps.slice(0, count)
    if (selected.length === 0) {
      throw new GvfError(
        'USAGE',
        'No --at timestamps remain inside the requested source range.'
      )
    }
    return SamplingPlanSchema.parse({
      strategy: 'at',
      timestampsSec: selected,
      fromSec: from,
      toSec: to,
      count: selected.length,
      capped,
      budget,
      equalDensity: !capped
    })
  }

  if (input.all) {
    const fps = parseUsage(PositiveFiniteSchema, input.sourceFps ?? 30, 'source fps')
    const uncapped = range <= 0 ? 0 : Math.max(1, Math.ceil(range * fps - 1e-10))
    const { count, capped } = applyBudget(uncapped)
    const effectiveIntervalSec = capped && count > 0 ? range / count : 1 / fps
    return SamplingPlanSchema.parse({
      strategy: 'all',
      requestedIntervalSec: 1 / fps,
      effectiveIntervalSec,
      fromSec: from,
      toSec: to,
      count,
      capped,
      budget,
      equalDensity: !capped
    })
  }

  if (input.count != null) {
    const requestedCount = parseUsage(PositiveIntegerSchema, input.count, '--count')
    const { count, capped } = applyBudget(requestedCount)
    const effectiveIntervalSec = count <= 0 ? range : range / count
    return SamplingPlanSchema.parse({
      strategy: 'count',
      requestedCount,
      effectiveIntervalSec,
      fromSec: from,
      toSec: to,
      count,
      capped,
      budget,
      equalDensity: !capped && requestedCount === count
    })
  }

  if (input.fps != null) {
    const requestedFps = parseUsage(PositiveFiniteSchema, input.fps, '--fps')
    const requestedIntervalSec = 1 / requestedFps
    const uncapped = intervalCount(requestedIntervalSec)
    const { count, capped } = applyBudget(uncapped)
    const effectiveIntervalSec =
      capped && count > 0 ? range / count : requestedIntervalSec
    return SamplingPlanSchema.parse({
      strategy: 'fps',
      requestedFps,
      requestedIntervalSec,
      effectiveIntervalSec: capped ? effectiveIntervalSec : requestedIntervalSec,
      fromSec: from,
      toSec: to,
      count,
      capped,
      budget,
      equalDensity: !capped
    })
  }

  // every
  const requestedIntervalSec = parseUsage(PositiveFiniteSchema, input.every, '--every')
  const uncapped = intervalCount(requestedIntervalSec)
  const { count, capped } = applyBudget(uncapped)
  const effectiveIntervalSec = capped && count > 0 ? range / count : requestedIntervalSec
  return SamplingPlanSchema.parse({
    strategy: 'every',
    requestedIntervalSec,
    effectiveIntervalSec: capped ? effectiveIntervalSec : requestedIntervalSec,
    fromSec: from,
    toSec: to,
    count,
    capped,
    budget,
    equalDensity: !capped
  })
}

/** Materialize timestamps (seconds) for a plan. */
export function planTimestamps(plan: SamplingPlan): number[] {
  if (plan.strategy === 'at' && plan.timestampsSec) {
    return [...plan.timestampsSec]
  }
  const from = plan.fromSec ?? 0
  const to = plan.toSec ?? from
  if (plan.count <= 0) return []
  if (plan.count === 1) return [from]
  const interval = plan.effectiveIntervalSec ?? DEFAULT_CANDIDATE_INTERVAL_SEC
  const times: number[] = []
  for (let i = 0; i < plan.count; i += 1) {
    const t = from + i * interval
    if (t >= to - 1e-10) break
    times.push(t)
  }
  return times
}

/** Preflight estimate for --all extract guards. */
export function estimateFrameCount(options: {
  durationSec: number
  fps: number
  from?: number
  to?: number
  strategy: 'all' | 'every' | 'fps' | 'count' | 'at'
  every?: number
  count?: number
  at?: number[]
}): number {
  const from = options.from ?? 0
  const to = options.to ?? options.durationSec
  const range = Math.max(0, to - from)
  switch (options.strategy) {
    case 'all':
      return range <= 0 ? 0 : Math.max(1, Math.ceil(range * options.fps - 1e-10))
    case 'count':
      return Math.max(1, options.count ?? 1)
    case 'at':
      return options.at?.length ?? 0
    case 'fps':
      return range <= 0
        ? 0
        : Math.max(1, Math.ceil(range * (options.every ? 1 / options.every : 1) - 1e-10))
    case 'every':
    default:
      return range <= 0 ? 0 : Math.max(1, Math.ceil(range / (options.every ?? 1) - 1e-10))
  }
}

export const DEFAULT_ALL_FRAME_WARN = 5_000
export const DEFAULT_ALL_BYTES_WARN = 2 * 1024 * 1024 * 1024 // 2 GiB estimate threshold
