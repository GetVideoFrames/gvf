export interface PixelBuffer {
  readonly data: ArrayLike<number>
  readonly width: number
  readonly height: number
  readonly channels?: 3 | 4
}

export interface SmartFrameInput {
  id: string
  timeMs: number
  pixels: PixelBuffer
}

export interface SceneDetectionOptions {
  sensitivity?: number
  debounceMs?: number
}

export interface DuplicateDetectionOptions {
  maxHammingDistance?: number
  maxColorDistance?: number
}

export interface BestFrameWeights {
  sharpness: number
  exposure: number
  uniqueness: number
  scenePosition: number
}

export interface SmartScanOptions {
  scene?: SceneDetectionOptions
  duplicate?: DuplicateDetectionOptions
  blurThreshold?: number
  minRecommendations?: number
  maxRecommendations?: number
  weights?: Partial<BestFrameWeights>
}

export interface SceneBoundary {
  frameIndex: number
  timeMs: number
  difference: number
}

export interface SceneRange {
  index: number
  startFrameIndex: number
  endFrameIndex: number
  startTimeMs: number
  endTimeMs: number
}

export interface FrameComponentScores {
  sharpness: number
  exposure: number
  uniqueness: number
  scenePosition: number
}

export interface SmartFrameResult {
  id: string
  timeMs: number
  sceneIndex: number
  sceneDifference: number
  blurVariance: number
  exposureMean: number
  exposureClippedRatio: number
  hash: Uint32Array
  duplicateOfId?: string
  componentScores: FrameComponentScores
  compositeScore: number
  recommended: boolean
  recommendationReason?: string
}

export interface SmartScanResult {
  sampledCount: number
  sceneCount: number
  blurryCount: number
  duplicateCount: number
  recommendedCount: number
  boundaries: SceneBoundary[]
  scenes: SceneRange[]
  frames: SmartFrameResult[]
  recommendedIds: string[]
  settings: Required<
    Pick<SmartScanOptions, 'blurThreshold' | 'minRecommendations' | 'maxRecommendations'>
  > & {
    scene: Required<SceneDetectionOptions>
    duplicate: Required<DuplicateDetectionOptions>
    weights: BestFrameWeights
  }
}
