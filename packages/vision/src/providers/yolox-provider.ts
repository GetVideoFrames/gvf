/**
 * Default YOLOX-Nano ONNX Runtime provider.
 * Weights are external (see model-manifest.json); never bundled in git/npm.
 */

import { access, constants } from 'node:fs'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  buildYoloxInput,
  decodeYoloxDetections,
  YOLOX_INPUT_SIZE,
  type ObjectDetection
} from './yolox.js'
import {
  OBJECT_SETUP_HINT,
  TEXT_SETUP_BLOCKED_HINT,
  TextVisionBlockedError,
  VisionNotReadyError,
  type DetectObjectsInput,
  type DetectTextInput,
  type VisionModelInfo,
  type VisionProvider
} from './types.js'
import type { TextDetection } from '../text/textmap.js'

const accessAsync = promisify(access)

export function defaultModelsDir(): string {
  return process.env.GVF_MODELS_DIR?.trim() || join(homedir(), '.gvf', 'models')
}

export function defaultYoloxPath(modelsDir = defaultModelsDir()): string {
  return join(modelsDir, 'yolox_nano.onnx')
}

type OrtModule = typeof import('onnxruntime-node')

export class YoloxNanoProvider implements VisionProvider {
  readonly id = 'yolox-nano' as const
  readonly supportsObjects = true
  readonly supportsText = false
  private readonly modelPath: string
  private session: Awaited<ReturnType<OrtModule['InferenceSession']['create']>> | null =
    null
  private TensorCtor: OrtModule['Tensor'] | null = null

  constructor(modelPath = defaultYoloxPath()) {
    this.modelPath = modelPath
  }

  info(): VisionModelInfo {
    return {
      providerId: 'yolox-nano',
      modelId: 'yolox_nano',
      version: '0.1.1rc0',
      provenanceId: 'megvii-yolox-nano-onnx-0.1.1rc0',
      path: this.modelPath
    }
  }

  async isReady(): Promise<boolean> {
    try {
      await accessAsync(this.modelPath, constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.session) return
    if (!(await this.isReady())) {
      throw new VisionNotReadyError(
        'YOLOX-Nano model weights are not installed.',
        OBJECT_SETUP_HINT
      )
    }
    let ort: OrtModule
    try {
      ort = await import('onnxruntime-node')
    } catch {
      throw new VisionNotReadyError(
        'onnxruntime-node is not installed (optional dependency).',
        'Run `npm install onnxruntime-node` in the GVF workspace, then `gvf setup vision`.'
      )
    }
    this.TensorCtor = ort.Tensor
    this.session = await ort.InferenceSession.create(this.modelPath)
  }

  async detectObjects(input: DetectObjectsInput): Promise<ObjectDetection[]> {
    await this.ensureSession()
    const tensorData = buildYoloxInput(input.rgb, YOLOX_INPUT_SIZE)
    const tensor = new this.TensorCtor!('float32', tensorData, [
      1,
      3,
      YOLOX_INPUT_SIZE,
      YOLOX_INPUT_SIZE
    ])
    const inputNames = this.session!.inputNames
    const feedName = inputNames.includes('images')
      ? 'images'
      : (inputNames[0] ?? 'images')
    const results = await this.session!.run({ [feedName]: tensor })
    const first = Object.values(results)[0]
    if (!first) return []
    return decodeYoloxDetections(first.data as Float32Array, {
      scoreThreshold: input.scoreThreshold,
      frameWidth: input.frameWidth,
      frameHeight: input.frameHeight
    })
  }

  async detectText(_input: DetectTextInput): Promise<TextDetection> {
    throw new TextVisionBlockedError(
      'Text detection weights are not available in this release.',
      TEXT_SETUP_BLOCKED_HINT
    )
  }
}

export function createDefaultVisionProvider(modelPath?: string): VisionProvider {
  return new YoloxNanoProvider(modelPath)
}
