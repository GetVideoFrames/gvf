/**
 * Pure YOLOX post-processing for all 80 COCO classes.
 * Adapted from GetVideoFrames Desktop yolox.ts (owned pure logic).
 */

import { cocoClassName, groupForClassId, type VisionGroup } from '../labels/coco.js'

export const YOLOX_INPUT_SIZE = 416
export const YOLOX_PAD_COLOR = '#727272'
const YOLOX_STRIDES = [8, 16, 32] as const

export interface NormalizedBox {
  /** Normalized [0,1] relative to the letterboxed model input, then mapped to content. */
  x: number
  y: number
  width: number
  height: number
}

export interface ObjectDetection {
  classId: number
  className: string
  group?: VisionGroup
  confidence: number
  /** Normalized bounding box in original frame coordinates (0–1). */
  box: NormalizedBox
}

interface GridCell {
  x: number
  y: number
  stride: number
}

function buildGrid(inputSize: number): GridCell[] {
  const cells: GridCell[] = []
  for (const stride of YOLOX_STRIDES) {
    const side = Math.floor(inputSize / stride)
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        cells.push({ x, y, stride })
      }
    }
  }
  return cells
}

export function yoloxCellCount(inputSize: number = YOLOX_INPUT_SIZE): number {
  return YOLOX_STRIDES.reduce(
    (sum, stride) => sum + Math.floor(inputSize / stride) ** 2,
    0
  )
}

type BoxLike = {
  x: number
  y: number
  width: number
  height: number
  score: number
}

function intersectionOverUnion(a: BoxLike, b: BoxLike): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.width * a.height + b.width * b.height - overlap
  return union > 0 ? overlap / union : 0
}

export function nonMaxSuppression<T extends BoxLike>(
  boxes: T[],
  iouThreshold = 0.45
): T[] {
  const sorted = boxes.slice().sort((first, second) => second.score - first.score)
  const kept: T[] = []
  for (const candidate of sorted) {
    if (kept.every((box) => intersectionOverUnion(box, candidate) < iouThreshold)) {
      kept.push(candidate)
    }
  }
  return kept
}

interface RawBox extends BoxLike {
  classId: number
}

/**
 * Decode all 80 COCO classes from a raw YOLOX output tensor [1, N, 85].
 */
export function decodeYoloxDetections(
  data: ArrayLike<number>,
  options: {
    inputSize?: number
    channels?: number
    scoreThreshold?: number
    iouThreshold?: number
    /** Original frame display size for denormalization after letterbox. */
    frameWidth?: number
    frameHeight?: number
  } = {}
): ObjectDetection[] {
  const inputSize = options.inputSize ?? YOLOX_INPUT_SIZE
  const channels = options.channels ?? 85
  const scoreThreshold = options.scoreThreshold ?? 0.4
  const iouThreshold = options.iouThreshold ?? 0.45
  const grid = buildGrid(inputSize)
  const cellCount = Math.min(grid.length, Math.floor(data.length / channels))
  const byClass = new Map<number, RawBox[]>()

  for (let index = 0; index < cellCount; index += 1) {
    const offset = index * channels
    const objectness = Number(data[offset + 4])
    if (objectness <= 0) continue

    let bestClassId = -1
    let bestScore = 0
    for (let classId = 0; classId < 80; classId += 1) {
      const score = objectness * Number(data[offset + 5 + classId])
      if (score > bestScore) {
        bestScore = score
        bestClassId = classId
      }
    }
    if (bestClassId < 0 || bestScore < scoreThreshold) continue

    const cell = grid[index]!
    const cx = (Number(data[offset]) + cell.x) * cell.stride
    const cy = (Number(data[offset + 1]) + cell.y) * cell.stride
    const width = Math.exp(Number(data[offset + 2])) * cell.stride
    const height = Math.exp(Number(data[offset + 3])) * cell.stride
    const box: RawBox = {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      score: bestScore,
      classId: bestClassId
    }
    const list = byClass.get(bestClassId)
    if (list) list.push(box)
    else byClass.set(bestClassId, [box])
  }

  const raw: RawBox[] = []
  for (const candidates of byClass.values()) {
    raw.push(...nonMaxSuppression(candidates, iouThreshold))
  }
  raw.sort((a, b) => b.score - a.score)

  const frameW = options.frameWidth ?? inputSize
  const frameH = options.frameHeight ?? inputSize
  const scale = Math.min(inputSize / frameW, inputSize / frameH)
  // Top-left letterbox (pad x=0,y=0) — matches buildYoloxDecodeArgs
  const padX = 0
  const padY = 0

  return raw.map((box) => {
    const x = Math.max(0, (box.x - padX) / scale) / frameW
    const y = Math.max(0, (box.y - padY) / scale) / frameH
    const width = Math.min(1 - x, box.width / scale / frameW)
    const height = Math.min(1 - y, box.height / scale / frameH)
    return {
      classId: box.classId,
      className: cocoClassName(box.classId),
      group: groupForClassId(box.classId),
      confidence: box.score,
      box: {
        x: clamp01(x),
        y: clamp01(y),
        width: clamp01(width),
        height: clamp01(height)
      }
    }
  })
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Convert letterboxed raw RGB into YOLOX BGR CHW float input (0–255).
 */
export function buildYoloxInput(
  rgb: ArrayLike<number>,
  inputSize: number = YOLOX_INPUT_SIZE
): Float32Array {
  const pixels = inputSize * inputSize
  const input = new Float32Array(3 * pixels)
  for (let index = 0; index < pixels; index += 1) {
    input[index] = Number(rgb[index * 3 + 2])
    input[pixels + index] = Number(rgb[index * 3 + 1])
    input[2 * pixels + index] = Number(rgb[index * 3])
  }
  return input
}
