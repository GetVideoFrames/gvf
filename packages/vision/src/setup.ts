/**
 * Guided / noninteractive vision model setup.
 * Downloads only assets with documented provenance in model-manifest.json.
 * Text weights are blocked until provenance is verified.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { z } from 'zod/v4'
import { defaultModelsDir } from './providers/yolox-provider.js'
import { OBJECT_SETUP_HINT, TEXT_SETUP_BLOCKED_HINT } from './providers/types.js'

const ModelAssetSchema = z.object({
  id: z.string(),
  file: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  url: z.string().url().optional(),
  releaseTag: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  origin: z.string(),
  upstreamVersion: z.string(),
  license: z.string(),
  licenseUrl: z.string().url().optional(),
  provenance: z.string(),
  status: z.enum(['available', 'blocked']),
  blockReason: z.string().optional()
})

export const ModelManifestSchema = z.object({
  schemaVersion: z.literal(1),
  models: z.array(ModelAssetSchema)
})

export type ModelManifest = z.infer<typeof ModelManifestSchema>

export function defaultManifestPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'model-manifest.json')
}

export async function loadModelManifest(
  path = defaultManifestPath()
): Promise<ModelManifest> {
  const raw = JSON.parse(await readFile(path, 'utf8'))
  return ModelManifestSchema.parse(raw)
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function download(url: string, filePath: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed HTTP ${response.status}: ${url}`)
  }
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    createWriteStream(filePath, { mode: 0o644 })
  )
}

export interface SetupVisionResult {
  modelsDir: string
  installed: string[]
  blocked: Array<{ id: string; reason: string }>
  alreadyPresent: string[]
  plans: VisionSetupPlan[]
}

export class UnknownVisionModelError extends Error {
  readonly code = 'USAGE'
  constructor(id: string, available: string[]) {
    super(`Unknown vision model "${id}". Available: ${available.join(', ')}`)
    this.name = 'UnknownVisionModelError'
  }
}

export interface VisionSetupPlan {
  provider: 'yolox-nano'
  model: string
  origin: string
  releaseTag: string
  upstreamVersion: string
  license: string
  licenseUrl: string
  sizeBytes: number
  sha256: string
  destination: string
  url: string
}

export class VisionSetupConsentError extends Error {
  readonly code = 'VISION_SETUP_CONFIRMATION_REQUIRED'
  readonly hint =
    'Review the setup plan, then rerun interactively or pass `gvf setup vision --yes`.'

  constructor(readonly plan: VisionSetupPlan) {
    super('Vision model download requires explicit confirmation.')
    this.name = 'VisionSetupConsentError'
  }
}

export async function getVisionSetupPlans(
  options: {
    modelsDir?: string
    only?: string
  } = {}
): Promise<VisionSetupPlan[]> {
  const modelsDir = options.modelsDir ?? defaultModelsDir()
  const manifest = await loadModelManifest()
  if (options.only && !manifest.models.some((model) => model.id === options.only)) {
    throw new UnknownVisionModelError(
      options.only,
      manifest.models.map((model) => model.id)
    )
  }
  return manifest.models
    .filter(
      (model) =>
        model.status === 'available' && (!options.only || model.id === options.only)
    )
    .map((model) => {
      if (!model.url || !model.releaseTag || !model.sizeBytes || !model.licenseUrl) {
        throw new Error(`Available model ${model.id} has incomplete provenance metadata.`)
      }
      return {
        provider: 'yolox-nano' as const,
        model: model.id,
        origin: model.origin,
        releaseTag: model.releaseTag,
        upstreamVersion: model.upstreamVersion,
        license: model.license,
        licenseUrl: model.licenseUrl,
        sizeBytes: model.sizeBytes,
        sha256: model.sha256,
        destination: join(modelsDir, model.file),
        url: model.url
      }
    })
}

export async function setupVision(options: {
  modelsDir?: string
  /** Only install this asset id (e.g. yolox-nano). */
  only?: string
  interactive?: boolean
  yes?: boolean
  confirm?: (plan: VisionSetupPlan) => Promise<boolean>
}): Promise<SetupVisionResult> {
  const modelsDir = options.modelsDir ?? defaultModelsDir()
  const manifest = await loadModelManifest()
  if (options.only && !manifest.models.some((model) => model.id === options.only)) {
    throw new UnknownVisionModelError(
      options.only,
      manifest.models.map((model) => model.id)
    )
  }
  const plans = await getVisionSetupPlans({ modelsDir, only: options.only })
  await mkdir(modelsDir, { recursive: true })
  const installed: string[] = []
  const alreadyPresent: string[] = []
  const blocked: Array<{ id: string; reason: string }> = []

  for (const model of manifest.models) {
    if (options.only && model.id !== options.only) continue

    if (model.status === 'blocked') {
      blocked.push({
        id: model.id,
        reason: model.blockReason ?? TEXT_SETUP_BLOCKED_HINT
      })
      continue
    }

    if (!model.url) {
      blocked.push({ id: model.id, reason: 'No download URL in manifest.' })
      continue
    }

    const finalPath = join(modelsDir, model.file)
    if (
      existsSync(finalPath) &&
      (await sha256(finalPath)) === model.sha256.toLowerCase()
    ) {
      alreadyPresent.push(model.id)
      continue
    }
    await rm(finalPath, { force: true })

    const [plan] = await getVisionSetupPlans({ modelsDir, only: model.id })
    if (!plan) throw new Error(`No setup plan for ${model.id}.`)
    const approved =
      options.yes === true ||
      (options.interactive === true &&
        options.confirm != null &&
        (await options.confirm(plan)))
    if (!approved) throw new VisionSetupConsentError(plan)

    const staging = join(modelsDir, `.${model.file}.partial`)
    await rm(staging, { force: true })
    await download(model.url, staging)
    const actual = await sha256(staging)
    if (actual.toLowerCase() !== model.sha256.toLowerCase()) {
      await rm(staging, { force: true })
      throw new Error(
        `${model.file} checksum mismatch.\n  expected ${model.sha256}\n  actual   ${actual}`
      )
    }
    const downloadedSize = (await stat(staging)).size
    if (model.sizeBytes != null && downloadedSize !== model.sizeBytes) {
      await rm(staging, { force: true })
      throw new Error(
        `${model.file} size mismatch: expected ${model.sizeBytes}, got ${downloadedSize}.`
      )
    }
    await rename(staging, finalPath)

    // Write a local provenance sidecar
    await writeFile(
      `${finalPath}.provenance.json`,
      JSON.stringify(
        {
          id: model.id,
          sha256: model.sha256,
          origin: model.origin,
          upstreamVersion: model.upstreamVersion,
          license: model.license,
          licenseUrl: model.licenseUrl,
          sizeBytes: model.sizeBytes,
          provenance: model.provenance,
          installedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )
    installed.push(model.id)
  }

  return { modelsDir, installed, blocked, alreadyPresent, plans }
}

export async function inspectVision(modelsDir = defaultModelsDir()): Promise<{
  objectsReady: boolean
  textReady: boolean
  textBlocked: true
  modelsDir: string
  yoloxPath: string
  filePresent: boolean
  sizeValid: boolean
  checksumValid: boolean
  runtimeAvailable: boolean
  modelLoadable: boolean
  error?: string
  hint: string
}> {
  const yoloxPath = join(modelsDir, 'yolox_nano.onnx')
  const manifest = await loadModelManifest()
  const model = manifest.models.find((item) => item.id === 'yolox-nano')!
  let filePresent = false
  let sizeValid = false
  let checksumValid = false
  let runtimeAvailable = false
  let modelLoadable = false
  let error: string | undefined
  try {
    await accessAsync(yoloxPath)
    filePresent = true
    sizeValid =
      model.sizeBytes == null || (await stat(yoloxPath)).size === model.sizeBytes
    checksumValid = sizeValid && (await sha256(yoloxPath)) === model.sha256.toLowerCase()
    try {
      const ort = await import('onnxruntime-node')
      runtimeAvailable = true
      if (checksumValid) {
        const session = await ort.InferenceSession.create(yoloxPath)
        modelLoadable = session.inputNames.length > 0
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  const objectsReady =
    filePresent && sizeValid && checksumValid && runtimeAvailable && modelLoadable
  return {
    objectsReady,
    textReady: false,
    textBlocked: true,
    modelsDir,
    yoloxPath,
    filePresent,
    sizeValid,
    checksumValid,
    runtimeAvailable,
    modelLoadable,
    error,
    hint: objectsReady
      ? 'Object detection model present. Text detection remains blocked pending provenance review.'
      : OBJECT_SETUP_HINT
  }
}

async function accessAsync(path: string): Promise<void> {
  const { access, constants } = await import('node:fs')
  const { promisify } = await import('node:util')
  await promisify(access)(path, constants.R_OK)
}
