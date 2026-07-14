/**
 * Canonical source identity for contracts persisted across cwd changes.
 * Source assets are not portable; only workspace-owned artifact paths are.
 */

import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'

export function canonicalSourcePath(inputPath: string): string {
  const absolute = resolve(inputPath)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}
