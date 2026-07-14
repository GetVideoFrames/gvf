/**
 * VisionProvider abstraction — v1 supports the built-in YOLOX-Nano object
 * provider. Custom provider/model CLI is NOT supported in v1.
 */

import { z } from 'zod/v4'
import type { ObjectDetection } from './yolox.js'
import type { TextDetection } from '../text/textmap.js'

export const VisionProviderIdSchema = z.enum(['yolox-nano'])
export type VisionProviderId = z.infer<typeof VisionProviderIdSchema>

export interface VisionModelInfo {
  providerId: VisionProviderId
  modelId: string
  version: string
  provenanceId: string
  path: string
}

export interface DetectObjectsInput {
  /** Raw RGB letterboxed to model input size. */
  rgb: ArrayLike<number>
  frameWidth: number
  frameHeight: number
  scoreThreshold?: number
}

export interface DetectTextInput {
  rgb: ArrayLike<number>
  width: number
  height: number
}

export interface VisionProvider {
  readonly id: VisionProviderId
  readonly supportsObjects: boolean
  readonly supportsText: boolean
  info(): VisionModelInfo | null
  isReady(): Promise<boolean>
  detectObjects(input: DetectObjectsInput): Promise<ObjectDetection[]>
  detectText(input: DetectTextInput): Promise<TextDetection>
}

export class VisionNotReadyError extends Error {
  readonly code = 'VISION_NOT_READY'
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'VisionNotReadyError'
    this.hint = hint
  }
}

export class TextVisionBlockedError extends Error {
  readonly code = 'TEXT_VISION_BLOCKED'
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'TextVisionBlockedError'
    this.hint = hint
  }
}

export const OBJECT_SETUP_HINT =
  'Object detection requires verified YOLOX-Nano weights and ONNX Runtime. ' +
  'Run `gvf setup vision` interactively or `gvf setup vision --yes` noninteractively. ' +
  'onnxruntime-node is an optional dependency.'

export const TEXT_SETUP_BLOCKED_HINT =
  'Text detection setup is blocked for public release until weight provenance ' +
  'and redistribution rights are verified. Interfaces and unit tests are ready; ' +
  'see docs/PROVENANCE.md. Do not claim text weights are available.'
