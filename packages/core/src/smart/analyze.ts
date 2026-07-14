import { DEFAULT_DUPLICATE_OPTIONS, differenceHash, hammingDistance } from './hash.js'
import { colorDistance, meanRgb } from './pixels.js'
import { measureBlur, measureExposure } from './quality.js'
import { DEFAULT_SCENE_OPTIONS, detectScenes } from './scene.js'
import { pickParetoBestFrameIds } from './pareto.js'
import type {
  BestFrameWeights,
  SmartFrameInput,
  SmartFrameResult,
  SmartScanOptions,
  SmartScanResult
} from './types.js'

export const DEFAULT_BEST_FRAME_WEIGHTS: BestFrameWeights = {
  sharpness: 0.45,
  exposure: 0.25,
  uniqueness: 0.2,
  scenePosition: 0.1
}

function normalizedWeights(
  input: Partial<BestFrameWeights> | undefined
): BestFrameWeights {
  const merged = { ...DEFAULT_BEST_FRAME_WEIGHTS, ...input }
  const total = Object.values(merged).reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return DEFAULT_BEST_FRAME_WEIGHTS
  return {
    sharpness: Math.max(0, merged.sharpness) / total,
    exposure: Math.max(0, merged.exposure) / total,
    uniqueness: Math.max(0, merged.uniqueness) / total,
    scenePosition: Math.max(0, merged.scenePosition) / total
  }
}

export function analyzeSmartFrames(
  inputs: readonly SmartFrameInput[],
  options: SmartScanOptions = {}
): SmartScanResult {
  const settings = {
    scene: { ...DEFAULT_SCENE_OPTIONS, ...options.scene },
    duplicate: { ...DEFAULT_DUPLICATE_OPTIONS, ...options.duplicate },
    blurThreshold: options.blurThreshold ?? 0.28,
    minRecommendations: Math.max(1, options.minRecommendations ?? 5),
    maxRecommendations: Math.max(1, options.maxRecommendations ?? 10),
    weights: normalizedWeights(options.weights)
  }
  settings.minRecommendations = Math.min(
    settings.minRecommendations,
    settings.maxRecommendations
  )

  const sceneAnalysis = detectScenes(inputs, settings.scene)
  const sceneByFrame = new Array<number>(inputs.length).fill(0)
  for (const scene of sceneAnalysis.scenes) {
    for (
      let frameIndex = scene.startFrameIndex;
      frameIndex <= scene.endFrameIndex;
      frameIndex += 1
    ) {
      sceneByFrame[frameIndex] = scene.index
    }
  }

  const hashes = inputs.map((input) => differenceHash(input.pixels))
  const colors = inputs.map((input) => meanRgb(input.pixels))
  const results: SmartFrameResult[] = []

  for (let index = 0; index < inputs.length; index += 1) {
    const blur = measureBlur(inputs[index].pixels)
    const exposure = measureExposure(inputs[index].pixels)
    let duplicateOfId: string | undefined
    let closestHashDistance = 128
    for (let previous = 0; previous < index; previous += 1) {
      const hashDistance = hammingDistance(hashes[index], hashes[previous])
      closestHashDistance = Math.min(closestHashDistance, hashDistance)
      if (
        !duplicateOfId &&
        hashDistance <= settings.duplicate.maxHammingDistance &&
        colorDistance(colors[index], colors[previous]) <=
          settings.duplicate.maxColorDistance
      ) {
        duplicateOfId = inputs[previous].id
      }
    }
    const scene = sceneAnalysis.scenes[sceneByFrame[index]]
    const sceneLength = scene ? scene.endFrameIndex - scene.startFrameIndex + 1 : 1
    const relative =
      scene && sceneLength > 1 ? (index - scene.startFrameIndex) / (sceneLength - 1) : 0.5
    const componentScores = {
      sharpness: blur.score,
      exposure: exposure.score,
      uniqueness: duplicateOfId ? 0 : Math.min(1, Math.max(0, closestHashDistance / 24)),
      scenePosition: Math.max(0, 1 - Math.abs(relative - 0.5) * 1.25)
    }
    const compositeScore =
      componentScores.sharpness * settings.weights.sharpness +
      componentScores.exposure * settings.weights.exposure +
      componentScores.uniqueness * settings.weights.uniqueness +
      componentScores.scenePosition * settings.weights.scenePosition
    results.push({
      id: inputs[index].id,
      timeMs: inputs[index].timeMs,
      sceneIndex: sceneByFrame[index],
      sceneDifference: sceneAnalysis.differences[index] ?? 0,
      blurVariance: blur.variance,
      exposureMean: exposure.mean,
      exposureClippedRatio: exposure.clippedRatio,
      hash: hashes[index],
      duplicateOfId,
      componentScores,
      compositeScore,
      recommended: false
    })
  }

  const selected = new Set<number>()
  const paretoIds = new Set(
    pickParetoBestFrameIds(
      results.map((result) => ({
        id: result.id,
        timeMs: result.timeMs,
        compositeScore: result.compositeScore,
        sharpnessScore: result.componentScores.sharpness,
        sceneIndex: result.sceneIndex,
        duplicateOfId: result.duplicateOfId
      }))
    )
  )
  results.forEach((result, index) => {
    if (paretoIds.has(result.id)) selected.add(index)
  })

  // Prefer at least one keeper per scene when Pareto is empty or sparse.
  for (const scene of sceneAnalysis.scenes) {
    const candidates = results
      .slice(scene.startFrameIndex, scene.endFrameIndex + 1)
      .map((result, offset) => ({
        result,
        index: scene.startFrameIndex + offset
      }))
      .filter(({ result }) => !result.duplicateOfId)
      .sort(
        (first, second) =>
          second.result.compositeScore - first.result.compositeScore ||
          first.result.timeMs - second.result.timeMs
      )
    if (candidates[0] && selected.size === 0) {
      selected.add(candidates[0].index)
    }
  }

  for (const index of selected) {
    const result = results[index]
    result.recommended = true
    const strongest = Object.entries(result.componentScores).sort(
      (first, second) => second[1] - first[1]
    )[0]?.[0]
    result.recommendationReason = `Pareto keeper; strongest ${strongest ?? 'quality'} score.`
  }

  const recommendedIds = [...selected]
    .sort((first, second) => results[first].timeMs - results[second].timeMs)
    .map((index) => results[index].id)

  return {
    sampledCount: inputs.length,
    sceneCount: sceneAnalysis.scenes.length,
    blurryCount: results.filter(
      (result) => result.componentScores.sharpness < settings.blurThreshold
    ).length,
    duplicateCount: results.filter((result) => result.duplicateOfId).length,
    recommendedCount: recommendedIds.length,
    boundaries: sceneAnalysis.boundaries,
    scenes: sceneAnalysis.scenes,
    frames: results,
    recommendedIds,
    settings
  }
}
