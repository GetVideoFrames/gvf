/**
 * Atomic JSON / JSONL workspace IO.
 */

import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  FrameRecordSchema,
  SCHEMA_MANIFEST,
  SCHEMA_SELECTIONS,
  SelectionsFileSchema,
  WorkspaceManifestSchema,
  type FrameRecord,
  type SelectionsFile,
  type WorkspaceManifest
} from '../schemas/v1alpha1.js'
import { GvfError } from '../errors/index.js'
import { canonicalSourcePath } from '../source.js'

export async function atomicWriteFile(
  filePath: string,
  contents: string | Buffer
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = join(dirname(filePath), `.${randomBytes(8).toString('hex')}.tmp`)
  try {
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, filePath)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw new GvfError('IO', `Failed to write ${filePath}`, {
      cause: error,
      details: { path: filePath }
    })
  }
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  pretty = true
): Promise<void> {
  const body = pretty
    ? JSON.stringify(value, null, 2) + '\n'
    : JSON.stringify(value) + '\n'
  await atomicWriteFile(filePath, body)
}

export function workspacePaths(root: string) {
  return {
    root,
    manifest: join(root, 'manifest.json'),
    framesJsonl: join(root, 'frames.jsonl'),
    selections: join(root, 'selections.json'),
    framesDir: join(root, 'frames')
  }
}

/** Prefer portable relative paths inside workspace artifacts. */
export function toArtifactPath(root: string, filePath: string): string {
  const absRoot = resolve(root)
  const absFile = resolve(filePath)
  const rel = relative(absRoot, absFile)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return absFile
  return rel.split('\\').join('/')
}

export function resolveArtifactPath(root: string, artifactPath: string): string {
  if (isAbsolute(artifactPath)) return artifactPath
  return resolve(root, artifactPath)
}

export function withAbsoluteFramePaths(
  root: string,
  records: readonly FrameRecord[]
): FrameRecord[] {
  return records.map((record) => ({
    ...record,
    path: resolveArtifactPath(root, record.path)
  }))
}

export function withRelativeFramePaths(
  root: string,
  records: readonly FrameRecord[]
): FrameRecord[] {
  return records.map((record) => ({
    ...record,
    path: toArtifactPath(root, record.path)
  }))
}

export async function createWorkspace(options: {
  root: string
  sourcePath: string
}): Promise<{ paths: ReturnType<typeof workspacePaths>; manifest: WorkspaceManifest }> {
  const paths = workspacePaths(options.root)
  await mkdir(paths.framesDir, { recursive: true })
  const now = new Date().toISOString()
  const manifest = WorkspaceManifestSchema.parse({
    schema: SCHEMA_MANIFEST,
    version: 1,
    createdAt: now,
    updatedAt: now,
    source: { path: canonicalSourcePath(options.sourcePath) },
    artifacts: {
      framesJsonl: 'frames.jsonl',
      selections: 'selections.json',
      framesDir: 'frames'
    }
  })
  await atomicWriteJson(paths.manifest, manifest)
  await atomicWriteFile(paths.framesJsonl, '')
  return { paths, manifest }
}

export async function readManifest(root: string): Promise<WorkspaceManifest> {
  const paths = workspacePaths(root)
  try {
    const raw = JSON.parse(await readFile(paths.manifest, 'utf8'))
    return WorkspaceManifestSchema.parse(raw)
  } catch (error) {
    throw new GvfError(
      'IO',
      `Invalid or missing workspace manifest at ${paths.manifest}`,
      {
        cause: error
      }
    )
  }
}

export async function writeManifest(
  root: string,
  manifest: WorkspaceManifest
): Promise<void> {
  const paths = workspacePaths(root)
  const next = WorkspaceManifestSchema.parse({
    ...manifest,
    updatedAt: new Date().toISOString()
  })
  await atomicWriteJson(paths.manifest, next)
}

export async function appendFrameRecords(
  root: string,
  records: readonly FrameRecord[]
): Promise<void> {
  const paths = workspacePaths(root)
  const portable = withRelativeFramePaths(root, records)
  const lines = portable.map((r) => JSON.stringify(FrameRecordSchema.parse(r))).join('\n')
  if (!lines) return
  const existing = await readFile(paths.framesJsonl, 'utf8').catch(() => '')
  const body = existing.trimEnd()
  const next = body ? `${body}\n${lines}\n` : `${lines}\n`
  await atomicWriteFile(paths.framesJsonl, next)
}

export async function writeFrameRecords(
  root: string,
  records: readonly FrameRecord[]
): Promise<void> {
  const paths = workspacePaths(root)
  const portable = withRelativeFramePaths(root, records)
  const lines = portable.map((r) => JSON.stringify(FrameRecordSchema.parse(r))).join('\n')
  await atomicWriteFile(paths.framesJsonl, lines ? `${lines}\n` : '')
}

export async function readFrameRecords(root: string): Promise<FrameRecord[]> {
  const paths = workspacePaths(root)
  const raw = await readFile(paths.framesJsonl, 'utf8').catch(() => '')
  if (!raw.trim()) return []
  const records: FrameRecord[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    records.push(FrameRecordSchema.parse(JSON.parse(line)))
  }
  return withAbsoluteFramePaths(root, records)
}

export async function writeSelections(
  root: string,
  selections: SelectionsFile
): Promise<void> {
  const paths = workspacePaths(root)
  await atomicWriteJson(paths.selections, SelectionsFileSchema.parse(selections))
}

export async function readSelections(
  pathOrRoot: string,
  isFile = false
): Promise<SelectionsFile> {
  const filePath = isFile ? pathOrRoot : workspacePaths(pathOrRoot).selections
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'))
    return SelectionsFileSchema.parse(raw)
  } catch (error) {
    throw new GvfError('IO', `Invalid selections file: ${filePath}`, { cause: error })
  }
}

export { SCHEMA_SELECTIONS }
