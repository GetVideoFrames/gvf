/** Selection helpers for review picks — no auto-export selection. */

export interface ScoredFrameRef {
  id: string
  timeMs?: number
  compositeScore?: number
  sharpnessScore?: number
  sceneIndex?: number
  duplicateOfId?: string | null
}

function scoreOf(frame: ScoredFrameRef): number {
  return typeof frame.compositeScore === 'number' ? frame.compositeScore : 0
}

function sharpnessOf(frame: ScoredFrameRef): number {
  return typeof frame.sharpnessScore === 'number' ? frame.sharpnessScore : 0
}

function dominates(left: ScoredFrameRef, right: ScoredFrameRef): boolean {
  const leftScore = scoreOf(left)
  const rightScore = scoreOf(right)
  const leftSharp = sharpnessOf(left)
  const rightSharp = sharpnessOf(right)
  const betterOrEqual = leftScore >= rightScore && leftSharp >= rightSharp
  const strictlyBetter = leftScore > rightScore || leftSharp > rightSharp
  return betterOrEqual && strictlyBetter
}

/**
 * Statistical + Pareto pick: non-dominated frames on (score, sharpness),
 * kept when they sit at/above mean + 0.5σ (or the single top frame).
 */
export function pickParetoBestFrameIds(frames: readonly ScoredFrameRef[]): string[] {
  const candidates = frames.filter((frame) => !frame.duplicateOfId)
  if (candidates.length === 0) return []

  const scores = candidates.map(scoreOf)
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length
  const variance =
    scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length
  const std = Math.sqrt(variance)
  const threshold = mean + Math.max(0.04, std * 0.5)

  const front = candidates.filter(
    (frame) =>
      !candidates.some((other) => other.id !== frame.id && dominates(other, frame))
  )

  const pool = front.length > 0 ? front : candidates
  const above = pool.filter((frame) => scoreOf(frame) >= threshold)
  const picked = (above.length > 0 ? above : pool)
    .slice()
    .sort(
      (first, second) =>
        scoreOf(second) - scoreOf(first) || (first.timeMs ?? 0) - (second.timeMs ?? 0)
    )

  if (picked.length === 0) {
    const top = candidates
      .slice()
      .sort((first, second) => scoreOf(second) - scoreOf(first))[0]
    return top ? [top.id] : []
  }

  return picked.map((frame) => frame.id)
}

/** One strongest non-duplicate frame per detected scene. */
export function pickSceneChangeFrameIds(frames: readonly ScoredFrameRef[]): string[] {
  const byScene = new Map<number, ScoredFrameRef>()
  for (const frame of frames) {
    if (frame.duplicateOfId) continue
    const scene = frame.sceneIndex ?? 0
    const current = byScene.get(scene)
    if (!current || scoreOf(frame) > scoreOf(current)) {
      byScene.set(scene, frame)
    }
  }
  return [...byScene.values()]
    .sort((first, second) => (first.timeMs ?? 0) - (second.timeMs ?? 0))
    .map((frame) => frame.id)
}
