import { assertPixelBuffer, sampleLuminance } from './pixels.js'
import type { PixelBuffer } from './types.js'

export interface BlurMeasurement {
  variance: number
  score: number
}

export interface ExposureMeasurement {
  mean: number
  clippedRatio: number
  score: number
}

export function measureBlur(buffer: PixelBuffer): BlurMeasurement {
  assertPixelBuffer(buffer)
  const width = Math.min(64, buffer.width)
  const height = Math.min(36, buffer.height)
  if (width < 3 || height < 3) {
    return { variance: 0, score: 0 }
  }
  const luma = sampleLuminance(buffer, width, height)
  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const laplacian =
        luma[index - width] +
        luma[index - 1] -
        4 * luma[index] +
        luma[index + 1] +
        luma[index + width]
      sum += laplacian
      sumSquares += laplacian * laplacian
      count += 1
    }
  }
  const mean = count > 0 ? sum / count : 0
  const variance = count > 0 ? Math.max(0, sumSquares / count - mean * mean) : 0
  const score = Math.min(1, Math.max(0, Math.log1p(variance * 2_000) / Math.log(81)))
  return { variance, score }
}

export function measureExposure(buffer: PixelBuffer): ExposureMeasurement {
  assertPixelBuffer(buffer)
  const luma = sampleLuminance(
    buffer,
    Math.min(64, buffer.width),
    Math.min(36, buffer.height)
  )
  let total = 0
  let clipped = 0
  for (const value of luma) {
    total += value
    if (value <= 0.025 || value >= 0.975) {
      clipped += 1
    }
  }
  const mean = luma.length > 0 ? total / luma.length : 0
  const clippedRatio = luma.length > 0 ? clipped / luma.length : 1
  const midpointScore = Math.max(0, 1 - Math.abs(mean - 0.5) / 0.5)
  const clippingScore = Math.max(0, 1 - clippedRatio * 2.5)
  return {
    mean,
    clippedRatio,
    score: midpointScore * 0.65 + clippingScore * 0.35
  }
}
