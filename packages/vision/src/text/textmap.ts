/**
 * Pure text-map post-processing (PP-OCR DBNet style probability maps).
 * v1: presence, normalized regions, count, approximate coverage — NO OCR.
 * Extended from Desktop textmap.ts to retain bounding regions.
 */

export interface TextRegion {
  /** Normalized bounding box in map/frame coordinates (0–1). */
  x: number
  y: number
  width: number
  height: number
  /** Pixel count of the connected component on the probability map. */
  pixelCount: number
}

export interface TextDetection {
  hasText: boolean
  /** Fraction of pixels above the probability threshold (0..1). */
  coverage: number
  /** Number of distinct text regions (4-connected components). */
  regionCount: number
  regions: TextRegion[]
}

export const TEXT_PROBABILITY_THRESHOLD = 0.3
const MIN_REGION_PIXELS = 24

export function measureTextMap(
  probabilityMap: ArrayLike<number>,
  width: number,
  height: number,
  options: { threshold?: number; minRegionPixels?: number } = {}
): TextDetection {
  const threshold = options.threshold ?? TEXT_PROBABILITY_THRESHOLD
  const minRegion = options.minRegionPixels ?? MIN_REGION_PIXELS
  const total = width * height
  const mask = new Uint8Array(total)
  let above = 0
  for (let index = 0; index < total; index += 1) {
    if (Number(probabilityMap[index]) > threshold) {
      mask[index] = 1
      above += 1
    }
  }

  const regions: TextRegion[] = []
  if (above >= minRegion) {
    const visited = new Uint8Array(total)
    const stack: number[] = []
    for (let start = 0; start < total; start += 1) {
      if (!mask[start] || visited[start]) continue
      let size = 0
      let minX = width
      let minY = height
      let maxX = 0
      let maxY = 0
      stack.push(start)
      visited[start] = 1
      while (stack.length > 0) {
        const current = stack.pop()!
        size += 1
        const x = current % width
        const y = Math.floor(current / width)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        const neighbors = [
          x > 0 ? current - 1 : -1,
          x < width - 1 ? current + 1 : -1,
          current - width,
          current + width
        ]
        for (const neighbor of neighbors) {
          if (neighbor >= 0 && neighbor < total && mask[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1
            stack.push(neighbor)
          }
        }
      }
      if (size >= minRegion) {
        regions.push({
          x: minX / width,
          y: minY / height,
          width: (maxX - minX + 1) / width,
          height: (maxY - minY + 1) / height,
          pixelCount: size
        })
      }
    }
  }

  return {
    hasText: regions.length > 0,
    coverage: total > 0 ? above / total : 0,
    regionCount: regions.length,
    regions
  }
}

/**
 * Convert raw RGB pixels into ImageNet-normalized CHW float input.
 * Kept for when a verified text-det model becomes available.
 */
export function buildTextDetInput(
  rgb: ArrayLike<number>,
  width: number,
  height: number
): Float32Array {
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const pixels = width * height
  const input = new Float32Array(3 * pixels)
  for (let index = 0; index < pixels; index += 1) {
    input[index] = (Number(rgb[index * 3]) / 255 - mean[0]!) / std[0]!
    input[pixels + index] = (Number(rgb[index * 3 + 1]) / 255 - mean[1]!) / std[1]!
    input[2 * pixels + index] = (Number(rgb[index * 3 + 2]) / 255 - mean[2]!) / std[2]!
  }
  return input
}
