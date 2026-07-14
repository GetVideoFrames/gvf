import { colorDistance, meanRgb, sampleLuminance } from './pixels.js'
import type {
  SceneBoundary,
  SceneDetectionOptions,
  SceneRange,
  SmartFrameInput
} from './types.js'

export const DEFAULT_SCENE_OPTIONS: Required<SceneDetectionOptions> = {
  sensitivity: 0.58,
  debounceMs: 650
}

export function frameDifference(
  first: SmartFrameInput['pixels'],
  second: SmartFrameInput['pixels']
): number {
  const firstLuma = sampleLuminance(first)
  const secondLuma = sampleLuminance(second)
  let pixelDifference = 0
  for (let index = 0; index < firstLuma.length; index += 1) {
    pixelDifference += Math.abs(firstLuma[index] - secondLuma[index])
  }
  pixelDifference /= firstLuma.length
  const meanDifference = colorDistance(meanRgb(first), meanRgb(second))
  return Math.min(1, pixelDifference * 0.72 + meanDifference * 0.28)
}

export function sceneThreshold(sensitivity: number): number {
  const safeSensitivity = Math.min(1, Math.max(0, sensitivity))
  return 0.2 - safeSensitivity * 0.15
}

/**
 * Cut threshold that adapts to the clip's own motion profile: a boundary
 * must stand clearly above the typical frame-to-frame difference. This keeps
 * static footage from splitting on noise and stops smooth, high-motion
 * footage from hiding real cuts under one fixed global threshold.
 */
export function adaptiveSceneThreshold(
  differences: readonly number[],
  sensitivity: number
): number {
  const base = sceneThreshold(sensitivity)
  const observed = differences.filter((value) => value > 0)
  if (observed.length < 3) return base
  const sorted = observed.slice().sort((first, second) => first - second)
  const median = sorted[Math.floor(sorted.length / 2)]
  const mean = observed.reduce((sum, value) => sum + value, 0) / observed.length
  const variance =
    observed.reduce((sum, value) => sum + (value - mean) ** 2, 0) / observed.length
  const std = Math.sqrt(variance)
  // A cut must exceed the typical motion level by a clear margin.
  const adaptive = median + Math.max(0.04, std * 1.5)
  return Math.max(base * 0.35, Math.min(base * 2.5, adaptive))
}

export function detectScenes(
  frames: readonly SmartFrameInput[],
  options: SceneDetectionOptions = {}
): { boundaries: SceneBoundary[]; scenes: SceneRange[]; differences: number[] } {
  if (frames.length === 0) {
    return { boundaries: [], scenes: [], differences: [] }
  }
  const settings = { ...DEFAULT_SCENE_OPTIONS, ...options }
  const differences = new Array<number>(frames.length).fill(0)
  for (let index = 1; index < frames.length; index += 1) {
    differences[index] = frameDifference(frames[index - 1].pixels, frames[index].pixels)
  }
  const threshold = adaptiveSceneThreshold(differences, settings.sensitivity)
  const boundaries: SceneBoundary[] = []
  let lastBoundaryTime = frames[0].timeMs

  for (let index = 1; index < frames.length; index += 1) {
    const difference = differences[index]
    if (
      difference >= threshold &&
      frames[index].timeMs - lastBoundaryTime >= settings.debounceMs
    ) {
      boundaries.push({
        frameIndex: index,
        timeMs: frames[index].timeMs,
        difference
      })
      lastBoundaryTime = frames[index].timeMs
    }
  }

  const starts = [0, ...boundaries.map((boundary) => boundary.frameIndex)]
  const scenes = starts.map((startFrameIndex, index) => {
    const endFrameIndex =
      index + 1 < starts.length ? starts[index + 1] - 1 : frames.length - 1
    return {
      index,
      startFrameIndex,
      endFrameIndex,
      startTimeMs: frames[startFrameIndex].timeMs,
      endTimeMs: frames[endFrameIndex].timeMs
    }
  })

  return { boundaries, scenes, differences }
}
