/**
 * Selection predicates, ranking, and reduction.
 * Text predicates require verified text metadata; absence is never inferred.
 */

import {
  cocoClassId,
  resolveObjectQuery,
  VISION_GROUP_CLASSES,
  type VisionGroup
} from '@gvf/vision'
import type { FrameRecord } from '../schemas/v1alpha1.js'
import { SCHEMA_SELECTIONS, type SelectionsFile } from '../schemas/v1alpha1.js'
import { GvfError } from '../errors/index.js'
import {
  parseUsage,
  DetectionConfidenceSchema,
  PositiveIntegerSchema,
  RankModeSchema,
  validateUnitRange
} from '../validation/options.js'

export type RankMode = 'quality' | 'sharpness' | 'exposure'

export interface SelectOptions {
  with?: string[]
  withAny?: string[]
  without?: string[]
  withText?: boolean
  withoutText?: boolean
  minTextCoverage?: number
  maxTextCoverage?: number
  minConfidence?: number
  minQuality?: number
  rank?: RankMode
  dedupe?: boolean
  bestPerScene?: number
  limit?: number
}

export function validateSelectOptions(options: SelectOptions): void {
  if (options.rank != null) parseUsage(RankModeSchema, options.rank, '--rank')
  if (options.minConfidence != null) {
    parseUsage(DetectionConfidenceSchema, options.minConfidence, '--min-confidence')
  }
  validateUnitRange(options.minQuality, '--min-quality')
  validateUnitRange(options.minTextCoverage, '--min-text-coverage')
  validateUnitRange(options.maxTextCoverage, '--max-text-coverage')
  if (
    options.minTextCoverage != null &&
    options.maxTextCoverage != null &&
    options.minTextCoverage > options.maxTextCoverage
  ) {
    throw new GvfError('USAGE', '--min-text-coverage cannot exceed --max-text-coverage.')
  }
  if (options.bestPerScene != null) {
    parseUsage(PositiveIntegerSchema, options.bestPerScene, '--best-per-scene')
  }
  if (options.limit != null) parseUsage(PositiveIntegerSchema, options.limit, '--limit')
}

function frameHasClass(frame: FrameRecord, classIds: number[], minConf: number): boolean {
  return (frame.detections ?? []).some(
    (d) => classIds.includes(d.classId) && d.confidence >= minConf
  )
}

function resolveQueryToClassIds(query: string): number[] {
  try {
    return resolveObjectQuery(query).classIds
  } catch {
    // allow direct coco name
    const id = cocoClassId(query)
    if (id == null) {
      throw new GvfError('USAGE', `Unknown class or group: ${query}`)
    }
    return [id]
  }
}

function score(frame: FrameRecord, rank: RankMode): number {
  const m = frame.metrics
  if (!m) return 0
  if (rank === 'sharpness') return m.sharpness ?? 0
  if (rank === 'exposure') return m.exposure ?? 0
  return m.composite ?? 0
}

export function filterFrames(
  frames: readonly FrameRecord[],
  options: SelectOptions
): FrameRecord[] {
  validateSelectOptions(options)
  const usesText =
    options.withText ||
    options.withoutText ||
    options.minTextCoverage != null ||
    options.maxTextCoverage != null
  if (usesText && frames.some((frame) => frame.text == null)) {
    throw new GvfError(
      'TEXT_VISION_BLOCKED',
      'Text predicates require populated text metadata for every frame; unanalyzed is not “no text”.'
    )
  }
  const usesObjects =
    (options.with?.length ?? 0) > 0 ||
    (options.withAny?.length ?? 0) > 0 ||
    (options.without?.length ?? 0) > 0
  if (usesObjects && frames.some((frame) => frame.detections == null)) {
    throw new GvfError(
      'VISION_NOT_READY',
      'Object predicates require complete detection metadata for every frame.'
    )
  }
  const minConf = options.minConfidence ?? 0.4
  const minQuality = options.minQuality ?? 0

  return frames.filter((frame) => {
    if (minQuality > 0 && (frame.metrics?.composite ?? 0) < minQuality) return false

    if (options.with?.length) {
      for (const q of options.with) {
        if (!frameHasClass(frame, resolveQueryToClassIds(q), minConf)) return false
      }
    }
    if (options.withAny?.length) {
      const ok = options.withAny.some((q) =>
        frameHasClass(frame, resolveQueryToClassIds(q), minConf)
      )
      if (!ok) return false
    }
    if (options.without?.length) {
      for (const q of options.without) {
        if (frameHasClass(frame, resolveQueryToClassIds(q), minConf)) return false
      }
    }
    if (options.withText) {
      if (!frame.text?.hasText) return false
    }
    if (options.withoutText) {
      if (frame.text?.hasText) return false
    }
    if (options.minTextCoverage != null) {
      if ((frame.text?.coverage ?? 0) < options.minTextCoverage) return false
    }
    if (options.maxTextCoverage != null) {
      if ((frame.text?.coverage ?? 0) > options.maxTextCoverage) return false
    }
    return true
  })
}

export function rankAndReduce(
  frames: readonly FrameRecord[],
  options: SelectOptions
): Array<{ frame: FrameRecord; reasons: Array<{ code: string; message: string }> }> {
  let pool = [...frames]

  if (options.dedupe) {
    pool = pool.filter((f) => !f.metrics?.duplicateOfId)
  }

  const rank = options.rank ?? 'quality'
  pool.sort((a, b) => score(b, rank) - score(a, rank) || a.timeMs - b.timeMs)

  if (options.bestPerScene != null && options.bestPerScene > 0) {
    const n = options.bestPerScene
    const byScene = new Map<number, FrameRecord[]>()
    for (const frame of pool) {
      const scene = frame.metrics?.sceneIndex ?? 0
      const list = byScene.get(scene) ?? []
      list.push(frame)
      byScene.set(scene, list)
    }
    pool = [...byScene.values()]
      .flatMap((list) => list.slice(0, n))
      .sort((a, b) => a.timeMs - b.timeMs)
  }

  if (options.limit != null && options.limit > 0) {
    pool = pool.slice(0, options.limit)
  }

  return pool.map((frame) => {
    const reasons: Array<{ code: string; message: string }> = []
    if (options.with?.length) {
      reasons.push({
        code: 'with',
        message: `Matched required: ${options.with.join(', ')}`
      })
    }
    if (options.withoutText) {
      reasons.push({ code: 'without-text', message: 'No text detected' })
    }
    if (options.withText) {
      reasons.push({ code: 'with-text', message: 'Text present' })
    }
    if (options.dedupe) {
      reasons.push({ code: 'dedupe', message: 'Not a perceptual duplicate' })
    }
    if (options.bestPerScene) {
      reasons.push({
        code: 'best-per-scene',
        message: `Top ${options.bestPerScene} in scene ${frame.metrics?.sceneIndex ?? 0}`
      })
    }
    reasons.push({
      code: 'rank',
      message: `Ranked by ${rank}: ${score(frame, rank).toFixed(3)}`
    })
    return { frame, reasons }
  })
}

export function buildSelectionsFile(
  frames: readonly FrameRecord[],
  options: SelectOptions,
  sourcePath?: string
): SelectionsFile {
  const filtered = filterFrames(frames, options)
  const ranked = rankAndReduce(filtered, options)
  return {
    schema: SCHEMA_SELECTIONS,
    createdAt: new Date().toISOString(),
    sourcePath,
    filters: {
      with: options.with,
      withAny: options.withAny,
      without: options.without,
      withText: options.withText,
      withoutText: options.withoutText,
      minTextCoverage: options.minTextCoverage,
      maxTextCoverage: options.maxTextCoverage,
      minConfidence: options.minConfidence,
      minQuality: options.minQuality
    },
    ranking: {
      rank: options.rank ?? 'quality',
      dedupe: options.dedupe ?? false,
      bestPerScene: options.bestPerScene,
      limit: options.limit
    },
    selections: ranked.map(({ frame, reasons }) => ({
      frameId: frame.id,
      timeMs: frame.timeMs,
      timeSec: frame.timeSec,
      reasons
    }))
  }
}

/** Extensible v1 presets — real aliases, not marketing fiction. */
export interface GvfPreset {
  id: string
  description: string
  select: SelectOptions
}

export const GVF_PRESETS: Record<string, GvfPreset> = {
  representative: {
    id: 'representative',
    description: 'Deduped quality ranking with one keeper per scene.',
    select: { rank: 'quality', dedupe: true, bestPerScene: 1 }
  },
  storyboard: {
    id: 'storyboard',
    description: 'One sharp frame per scene for a visual outline.',
    select: { rank: 'sharpness', dedupe: true, bestPerScene: 1 }
  },
  people: {
    id: 'people',
    description: 'Frames with people, sharpest per scene.',
    select: {
      with: ['person'],
      rank: 'sharpness',
      dedupe: true,
      bestPerScene: 1
    }
  }
}

export function applyPreset(
  presetId: string,
  overrides: SelectOptions = {}
): SelectOptions {
  const preset = GVF_PRESETS[presetId]
  if (!preset) {
    throw new GvfError(
      'USAGE',
      `Unknown preset "${presetId}". Available: ${Object.keys(GVF_PRESETS).join(', ')}`
    )
  }
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  ) as SelectOptions
  return { ...preset.select, ...definedOverrides }
}

export function groupClassIds(group: VisionGroup): readonly number[] {
  return VISION_GROUP_CLASSES[group]
}
