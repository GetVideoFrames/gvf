/**
 * Optional managed-asset provenance helpers.
 * GVF never ships FFmpeg binaries in git or npm; this documents external sources.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod/v4'

export const FfmpegAssetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  license: z.string(),
  note: z.string(),
  binaries: z.array(
    z.object({
      id: z.enum(['ffmpeg', 'ffprobe']),
      platform: z.string(),
      arch: z.string(),
      filename: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i),
      sourceUrl: z.string().url().optional(),
      approvedAt: z.string().optional(),
      status: z.enum(['available', 'blocked']).optional(),
      blockReason: z.string().optional()
    })
  )
})

export type FfmpegAssetManifest = z.infer<typeof FfmpegAssetManifestSchema>

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

export async function verifySha256(
  filePath: string,
  expected: string
): Promise<{ ok: boolean; actual: string }> {
  const actual = await sha256File(filePath)
  return { ok: actual.toLowerCase() === expected.toLowerCase(), actual }
}
