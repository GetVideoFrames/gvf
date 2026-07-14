import { colorDistance, meanRgb, sampleLuminance } from './pixels.js'
import type { DuplicateDetectionOptions, PixelBuffer } from './types.js'

export const DEFAULT_DUPLICATE_OPTIONS: Required<DuplicateDetectionOptions> = {
  maxHammingDistance: 4,
  maxColorDistance: 0.035
}

function setBit(hash: Uint32Array, bit: number): void {
  hash[Math.floor(bit / 32)] |= 1 << (bit % 32)
}

export function differenceHash(buffer: PixelBuffer): Uint32Array {
  const horizontal = sampleLuminance(buffer, 9, 8)
  const vertical = sampleLuminance(buffer, 8, 9)
  const hash = new Uint32Array(4)
  let bit = 0
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (horizontal[y * 9 + x] > horizontal[y * 9 + x + 1]) {
        setBit(hash, bit)
      }
      bit += 1
    }
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (vertical[y * 8 + x] > vertical[(y + 1) * 8 + x]) {
        setBit(hash, bit)
      }
      bit += 1
    }
  }
  return hash
}

function popcount(value: number): number {
  let bits = value >>> 0
  bits -= (bits >>> 1) & 0x55555555
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export function hammingDistance(first: Uint32Array, second: Uint32Array): number {
  const words = Math.max(first.length, second.length)
  let distance = 0
  for (let index = 0; index < words; index += 1) {
    distance += popcount((first[index] ?? 0) ^ (second[index] ?? 0))
  }
  return distance
}

export function arePerceptualDuplicates(
  first: PixelBuffer,
  second: PixelBuffer,
  options: DuplicateDetectionOptions = {}
): boolean {
  const settings = { ...DEFAULT_DUPLICATE_OPTIONS, ...options }
  return (
    hammingDistance(differenceHash(first), differenceHash(second)) <=
      settings.maxHammingDistance &&
    colorDistance(meanRgb(first), meanRgb(second)) <= settings.maxColorDistance
  )
}
