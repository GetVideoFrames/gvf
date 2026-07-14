import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { GvfError } from '../errors/index.js'

const GVF_FRAME_FILE = /^frame_\d{6}\.(?:jpe?g|png|webp)$/i
const GVF_WORKSPACE_FILE = /^(?:manifest\.json|frames\.jsonl|selections\.json)$/

/**
 * Prepare an output directory without ever recursively deleting it.
 * With overwrite, only known GVF artifacts are removed; unrelated files survive.
 */
export async function prepareOutputDirectory(
  directory: string,
  options: { overwrite?: boolean; workspace?: boolean } = {}
): Promise<void> {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.length === 0) return

  if (!options.overwrite) {
    throw new GvfError('GUARD', `Output directory is not empty: ${directory}`, {
      hint: 'Choose a fresh/empty directory or pass --overwrite. GVF never deletes unrelated files.',
      details: { directory }
    })
  }

  for (const entry of entries) {
    if (entry.isFile() && GVF_FRAME_FILE.test(entry.name)) {
      await rm(join(directory, entry.name), { force: true })
    } else if (
      options.workspace &&
      entry.isFile() &&
      GVF_WORKSPACE_FILE.test(entry.name)
    ) {
      await rm(join(directory, entry.name), { force: true })
    } else if (options.workspace && entry.isDirectory() && entry.name === 'frames') {
      await prepareOutputDirectory(join(directory, entry.name), { overwrite: true })
    }
  }

  const remaining = await readdir(directory)
  const nonGvf = remaining.filter((name) => {
    if (options.workspace && name === 'frames') return false
    return (
      !GVF_FRAME_FILE.test(name) && !(options.workspace && GVF_WORKSPACE_FILE.test(name))
    )
  })
  if (nonGvf.length > 0 && !options.overwrite) {
    throw new GvfError('GUARD', `Output directory contains unrelated files: ${directory}`)
  }
}

/** Export guard: overwrite permits exact planned targets but does not delete anything. */
export async function guardOutputDirectory(
  directory: string,
  overwrite = false
): Promise<void> {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  if (entries.length > 0 && !overwrite) {
    throw new GvfError('GUARD', `Output directory is not empty: ${directory}`, {
      hint: 'Choose a fresh/empty directory or pass --overwrite. Unrelated files are preserved.',
      details: { directory }
    })
  }
}

export function sourceSubdirectories(inputs: readonly string[]): string[] {
  const used = new Map<string, number>()
  return inputs.map((input) => {
    const filename = input.split(/[\\/]/).at(-1) ?? 'video'
    const raw = filename.replace(/\.[^.]+$/, '')
    const stem = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'video'
    const seen = (used.get(stem.toLowerCase()) ?? 0) + 1
    used.set(stem.toLowerCase(), seen)
    return seen === 1 ? stem : `${stem}-${seen}`
  })
}
