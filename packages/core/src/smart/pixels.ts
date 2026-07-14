import type { PixelBuffer } from './types.js'

export function pixelChannels(buffer: PixelBuffer): 3 | 4 {
  if (buffer.channels) return buffer.channels
  const pixels = buffer.width * buffer.height
  return pixels > 0 && buffer.data.length === pixels * 3 ? 3 : 4
}

export function assertPixelBuffer(buffer: PixelBuffer): void {
  const channels = pixelChannels(buffer)
  if (
    !Number.isInteger(buffer.width) ||
    !Number.isInteger(buffer.height) ||
    buffer.width <= 0 ||
    buffer.height <= 0 ||
    buffer.data.length < buffer.width * buffer.height * channels
  ) {
    throw new TypeError('Pixel buffer dimensions do not match its data.')
  }
}

export function luminanceAt(buffer: PixelBuffer, x: number, y: number): number {
  const channels = pixelChannels(buffer)
  const safeX = Math.min(buffer.width - 1, Math.max(0, x))
  const safeY = Math.min(buffer.height - 1, Math.max(0, y))
  const offset = (safeY * buffer.width + safeX) * channels
  return (
    (0.2126 * Number(buffer.data[offset]) +
      0.7152 * Number(buffer.data[offset + 1]) +
      0.0722 * Number(buffer.data[offset + 2])) /
    255
  )
}

export function meanRgb(buffer: PixelBuffer): [number, number, number] {
  assertPixelBuffer(buffer)
  const channels = pixelChannels(buffer)
  const count = buffer.width * buffer.height
  let red = 0
  let green = 0
  let blue = 0
  for (let offset = 0; offset < count * channels; offset += channels) {
    red += Number(buffer.data[offset])
    green += Number(buffer.data[offset + 1])
    blue += Number(buffer.data[offset + 2])
  }
  const denominator = count * 255
  return [red / denominator, green / denominator, blue / denominator]
}

export function colorDistance(
  first: readonly number[],
  second: readonly number[]
): number {
  const red = (first[0] ?? 0) - (second[0] ?? 0)
  const green = (first[1] ?? 0) - (second[1] ?? 0)
  const blue = (first[2] ?? 0) - (second[2] ?? 0)
  return Math.sqrt(red * red + green * green + blue * blue) / Math.sqrt(3)
}

export function sampleLuminance(
  buffer: PixelBuffer,
  columns = 32,
  rows = 18
): Float32Array {
  assertPixelBuffer(buffer)
  const output = new Float32Array(columns * rows)
  for (let y = 0; y < rows; y += 1) {
    const sourceY = Math.min(
      buffer.height - 1,
      Math.floor(((y + 0.5) * buffer.height) / rows)
    )
    for (let x = 0; x < columns; x += 1) {
      const sourceX = Math.min(
        buffer.width - 1,
        Math.floor(((x + 0.5) * buffer.width) / columns)
      )
      output[y * columns + x] = luminanceAt(buffer, sourceX, sourceY)
    }
  }
  return output
}
