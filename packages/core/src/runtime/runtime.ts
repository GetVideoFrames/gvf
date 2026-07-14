/**
 * Runtime inspection and setup orchestration (ffmpeg + vision).
 */

import {
  inspectFFmpeg,
  resolveFFmpeg,
  SETUP_HINT,
  setupFfmpeg,
  buildFfmpegSetupPlan,
  loadSidecarManifest,
  platformRuntimeDir,
  FfmpegSetupBlockedError,
  FfmpegSetupConsentError,
  type ResolveFFmpegOptions,
  type FfmpegSetupPlan
} from '@gvf/ffmpeg'
import {
  inspectVision,
  setupVision,
  OBJECT_SETUP_HINT,
  TEXT_SETUP_BLOCKED_HINT,
  defaultModelsDir,
  VisionSetupConsentError,
  UnknownVisionModelError,
  type VisionSetupPlan
} from '@gvf/vision'
import { GvfError } from '../errors/index.js'

export interface RuntimeStatus {
  schema: 'gvf.runtime/v1alpha1'
  ffmpeg: {
    ok: boolean
    path?: string
    ffprobePath?: string
    version?: string
    source?: string
    error?: string
    hint: string
  }
  vision: {
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
  }
  node: string
  platform: string
  arch: string
  contract: 'v1alpha1'
  stability: 'unstable'
}

export async function inspectRuntime(
  options: ResolveFFmpegOptions & { modelsDir?: string } = {}
): Promise<RuntimeStatus> {
  const ffmpeg = await inspectFFmpeg(options)
  const vision = await inspectVision(options.modelsDir)
  return {
    schema: 'gvf.runtime/v1alpha1',
    ffmpeg: {
      ok: ffmpeg.ok,
      path: ffmpeg.paths?.ffmpegPath,
      ffprobePath: ffmpeg.paths?.ffprobePath,
      version: ffmpeg.paths?.version,
      source: ffmpeg.paths?.source,
      error: ffmpeg.error,
      hint: ffmpeg.hint
    },
    vision: {
      objectsReady: vision.objectsReady,
      textReady: vision.textReady,
      textBlocked: true,
      modelsDir: vision.modelsDir,
      yoloxPath: vision.yoloxPath,
      filePresent: vision.filePresent,
      sizeValid: vision.sizeValid,
      checksumValid: vision.checksumValid,
      runtimeAvailable: vision.runtimeAvailable,
      modelLoadable: vision.modelLoadable,
      error: vision.error,
      hint: vision.hint
    },
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    contract: 'v1alpha1',
    stability: 'unstable'
  }
}

export async function setupRuntime(
  target: 'ffmpeg' | 'vision',
  options: {
    interactive?: boolean
    modelsDir?: string
    ffmpegPath?: string
    ffprobePath?: string
    only?: string
    yes?: boolean
    confirmVisionSetup?: (plan: VisionSetupPlan) => Promise<boolean>
    confirmFfmpegSetup?: (plan: FfmpegSetupPlan) => Promise<boolean>
  } = {}
): Promise<Record<string, unknown>> {
  if (target === 'ffmpeg') {
    const status = await inspectFFmpeg({
      ffmpegPath: options.ffmpegPath,
      ffprobePath: options.ffprobePath
    })
    if (status.ok) {
      return {
        schema: 'gvf.setup/v1alpha1',
        target: 'ffmpeg',
        ok: true,
        paths: status.paths,
        message:
          'FFmpeg already available. GVF uses explicit/env/system paths before managed fallback; binaries are not packaged in npm.'
      }
    }

    try {
      return await setupFfmpeg({
        interactive: options.interactive,
        yes: options.yes,
        confirm: options.confirmFfmpegSetup
      })
    } catch (error) {
      if (error instanceof FfmpegSetupBlockedError) {
        return {
          schema: 'gvf.setup/v1alpha1',
          target: 'ffmpeg',
          ok: false,
          blocked: true,
          plan: error.plan,
          message: error.message,
          hint: error.hint,
          destination: platformRuntimeDir(),
          note: 'Managed sidecar install is ready in code but blocked until provenance URLs/SHA-256 are approved.'
        }
      }
      if (error instanceof FfmpegSetupConsentError) {
        throw new GvfError('GUARD', error.message, {
          hint: error.hint,
          details: { plan: error.plan }
        })
      }
      const plan = buildFfmpegSetupPlan(await loadSidecarManifest())
      return {
        schema: 'gvf.setup/v1alpha1',
        target: 'ffmpeg',
        ok: false,
        plan,
        message: error instanceof Error ? error.message : String(error),
        hint: SETUP_HINT
      }
    }
  }

  // vision
  let result
  try {
    result = await setupVision({
      modelsDir: options.modelsDir ?? defaultModelsDir(),
      only: options.only,
      interactive: options.interactive,
      yes: options.yes,
      confirm: options.confirmVisionSetup
    })
  } catch (error) {
    if (error instanceof UnknownVisionModelError) {
      throw new GvfError('USAGE', error.message)
    }
    if (error instanceof VisionSetupConsentError) {
      throw new GvfError('GUARD', error.message, {
        hint: error.hint,
        details: { plan: error.plan }
      })
    }
    throw error
  }
  return {
    schema: 'gvf.setup/v1alpha1',
    target: 'vision',
    ok: result.installed.length > 0 || result.alreadyPresent.length > 0,
    ...result,
    textNote: TEXT_SETUP_BLOCKED_HINT,
    objectHint: OBJECT_SETUP_HINT
  }
}

export async function requireFFmpeg(options: ResolveFFmpegOptions = {}) {
  try {
    return await resolveFFmpeg(options)
  } catch (error) {
    throw new GvfError(
      'FFMPEG_NOT_FOUND',
      error instanceof Error ? error.message : 'FFmpeg not found',
      {
        hint:
          error && typeof error === 'object' && 'hint' in error
            ? String((error as { hint: string }).hint)
            : SETUP_HINT
      }
    )
  }
}
