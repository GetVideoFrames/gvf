/**
 * Managed FFmpeg sidecar setup — runtime management, not MIT GVF source.
 * Downloads only when sidecar-manifest.json marks an asset available with URL + SHA-256.
 * Platform sidecars are currently blocked; system FFmpeg remains the supported path.
 */

import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { z } from 'zod/v4'
import { sha256File, verifySha256 } from './checksum.js'

export const SETUP_HINT =
  'Install FFmpeg on your PATH, or set GVF_FFMPEG_PATH / GVF_FFPROBE_PATH. ' +
  'Run `gvf setup ffmpeg` for guided setup. GVF does not ship FFmpeg binaries.'

const SidecarBinarySchema = z.object({
  id: z.enum(['ffmpeg', 'ffprobe']),
  platform: z.string(),
  arch: z.string(),
  filename: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceUrl: z.string().url().optional(),
  license: z.string().optional(),
  licenseUrl: z.string().url().optional(),
  upstreamVersion: z.string().optional(),
  approvedAt: z.string().optional(),
  status: z.enum(['available', 'blocked']),
  blockReason: z.string().optional()
})

export const SidecarManifestSchema = z.object({
  schemaVersion: z.literal(1),
  license: z.string(),
  note: z.string(),
  binaries: z.array(SidecarBinarySchema)
})

export type SidecarManifest = z.infer<typeof SidecarManifestSchema>
export type SidecarBinary = z.infer<typeof SidecarBinarySchema>

export function defaultSidecarManifestPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'sidecar-manifest.json')
}

export function defaultRuntimeDir(): string {
  return (
    process.env.GVF_FFMPEG_DIR?.trim() || join(homedir(), '.gvf', 'runtime', 'ffmpeg')
  )
}

export function platformRuntimeDir(runtimeDir = defaultRuntimeDir()): string {
  return join(runtimeDir, `${process.platform}-${process.arch}`)
}

export async function loadSidecarManifest(
  path = defaultSidecarManifestPath()
): Promise<SidecarManifest> {
  const raw = JSON.parse(await readFile(path, 'utf8'))
  return SidecarManifestSchema.parse(raw)
}

export function currentPlatformBinaries(manifest: SidecarManifest): SidecarBinary[] {
  return manifest.binaries.filter(
    (b) => b.platform === process.platform && b.arch === process.arch
  )
}

export interface FfmpegSetupPlan {
  schema: 'gvf.ffmpeg-setup-plan/v1alpha1'
  target: 'ffmpeg'
  license: string
  note: string
  destination: string
  binaries: Array<{
    id: string
    filename: string
    sha256: string
    sourceUrl?: string
    upstreamVersion?: string
    license?: string
    licenseUrl?: string
    status: 'available' | 'blocked'
    blockReason?: string
  }>
  systemGuidance: string
}

export function buildFfmpegSetupPlan(
  manifest: SidecarManifest,
  destination = platformRuntimeDir()
): FfmpegSetupPlan {
  const binaries = currentPlatformBinaries(manifest)
  const platformInstructions =
    process.platform === 'darwin'
      ? 'macOS: `brew install ffmpeg`'
      : process.platform === 'win32'
        ? 'Windows: `winget install Gyan.FFmpeg` or `choco install ffmpeg`'
        : 'Linux: `sudo apt install ffmpeg` (Debian/Ubuntu) or your distribution package manager'
  return {
    schema: 'gvf.ffmpeg-setup-plan/v1alpha1',
    target: 'ffmpeg',
    license: manifest.license,
    note: manifest.note,
    destination,
    binaries: binaries.map((b) => ({
      id: b.id,
      filename: b.filename,
      sha256: b.sha256,
      sourceUrl: b.sourceUrl,
      upstreamVersion: b.upstreamVersion,
      license: b.license ?? manifest.license,
      licenseUrl: b.licenseUrl,
      status: b.status,
      blockReason: b.blockReason
    })),
    systemGuidance: `${platformInstructions}. Or set GVF_FFMPEG_PATH / GVF_FFPROBE_PATH.`
  }
}

export class FfmpegSetupBlockedError extends Error {
  readonly code = 'FFMPEG_SIDECAR_BLOCKED'
  readonly hint = SETUP_HINT
  constructor(
    message: string,
    readonly plan: FfmpegSetupPlan
  ) {
    super(message)
    this.name = 'FfmpegSetupBlockedError'
  }
}

export class FfmpegSetupConsentError extends Error {
  readonly code = 'FFMPEG_SETUP_CONFIRMATION_REQUIRED'
  readonly hint =
    'Review the setup plan, then rerun interactively or pass `gvf setup ffmpeg --yes`.'
  constructor(readonly plan: FfmpegSetupPlan) {
    super('FFmpeg sidecar download requires explicit confirmation.')
    this.name = 'FfmpegSetupConsentError'
  }
}

async function download(url: string, filePath: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed HTTP ${response.status}: ${url}`)
  }
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    createWriteStream(filePath, { mode: 0o755 })
  )
}

export async function inspectManagedFfmpeg(runtimeDir = defaultRuntimeDir()): Promise<{
  ok: boolean
  source: 'managed'
  ffmpegPath?: string
  ffprobePath?: string
  destination: string
  error?: string
}> {
  const destination = platformRuntimeDir(runtimeDir)
  const manifest = await loadSidecarManifest()
  const binaries = currentPlatformBinaries(manifest)
  const ffmpegMeta = binaries.find((b) => b.id === 'ffmpeg')
  const ffprobeMeta = binaries.find((b) => b.id === 'ffprobe')
  if (!ffmpegMeta || !ffprobeMeta) {
    return {
      ok: false,
      source: 'managed',
      destination,
      error: `No sidecar manifest entries for ${process.platform}-${process.arch}.`
    }
  }
  const ffmpegPath = join(destination, ffmpegMeta.filename)
  const ffprobePath = join(destination, ffprobeMeta.filename)
  if (!existsSync(ffmpegPath) || !existsSync(ffprobePath)) {
    return {
      ok: false,
      source: 'managed',
      destination,
      error: 'Managed sidecar not installed.'
    }
  }
  const ffmpegCheck = await verifySha256(ffmpegPath, ffmpegMeta.sha256)
  const ffprobeCheck = await verifySha256(ffprobePath, ffprobeMeta.sha256)
  if (!ffmpegCheck.ok || !ffprobeCheck.ok) {
    return {
      ok: false,
      source: 'managed',
      destination,
      ffmpegPath,
      ffprobePath,
      error: 'Managed sidecar checksum mismatch.'
    }
  }
  if (ffmpegMeta.status !== 'available' || ffprobeMeta.status !== 'available') {
    return {
      ok: false,
      source: 'managed',
      destination,
      ffmpegPath,
      ffprobePath,
      error: 'Managed sidecar present but provenance status is not available.'
    }
  }
  return { ok: true, source: 'managed', destination, ffmpegPath, ffprobePath }
}

export async function setupFfmpeg(
  options: {
    interactive?: boolean
    yes?: boolean
    runtimeDir?: string
    confirm?: (plan: FfmpegSetupPlan) => Promise<boolean>
  } = {}
): Promise<Record<string, unknown>> {
  const manifest = await loadSidecarManifest()
  const destination = platformRuntimeDir(options.runtimeDir ?? defaultRuntimeDir())
  const plan = buildFfmpegSetupPlan(manifest, destination)
  const binaries = currentPlatformBinaries(manifest)

  if (binaries.length === 0) {
    throw new FfmpegSetupBlockedError(
      `No FFmpeg sidecar definitions for ${process.platform}-${process.arch}.`,
      plan
    )
  }

  const blocked = binaries.filter((b) => b.status !== 'available' || !b.sourceUrl)
  if (blocked.length > 0) {
    throw new FfmpegSetupBlockedError(
      'Managed FFmpeg sidecar download is blocked until platform provenance is approved. ' +
        plan.systemGuidance,
      plan
    )
  }

  if (!options.yes) {
    if (!options.interactive || !options.confirm) {
      throw new FfmpegSetupConsentError(plan)
    }
    const approved = await options.confirm(plan)
    if (!approved) {
      throw new FfmpegSetupConsentError(plan)
    }
  }

  await mkdir(destination, { recursive: true })
  const installed: string[] = []
  for (const binary of binaries) {
    const target = join(destination, binary.filename)
    const tmp = `${target}.${process.pid}.tmp`
    try {
      await download(binary.sourceUrl!, tmp)
      const digest = await sha256File(tmp)
      if (digest.toLowerCase() !== binary.sha256.toLowerCase()) {
        throw new Error(
          `Checksum mismatch for ${binary.id}: expected ${binary.sha256}, got ${digest}`
        )
      }
      await rename(tmp, target)
      await chmod(target, 0o755)
      installed.push(binary.id)
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined)
    }
  }

  return {
    schema: 'gvf.setup/v1alpha1',
    target: 'ffmpeg',
    ok: true,
    destination,
    installed,
    plan,
    message:
      'Verified external FFmpeg sidecar installed. This is runtime management, not MIT-licensed GVF source.'
  }
}
