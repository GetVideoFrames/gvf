/**
 * FFmpeg process helpers — spawn with shell:false, AbortSignal cancellation.
 * Extracted/adapted from GetVideoFrames Desktop (owned logic, no Electron).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export function spawnTool(
  binaryPath: string,
  args: readonly string[],
  options?: { cwd?: string; signal?: AbortSignal }
): ChildProcessWithoutNullStreams {
  const child = spawn(binaryPath, [...args], {
    shell: false,
    windowsHide: true,
    cwd: options?.cwd
  })

  if (options?.signal) {
    const onAbort = (): void => {
      child.kill('SIGTERM')
    }
    if (options.signal.aborted) onAbort()
    else {
      options.signal.addEventListener('abort', onAbort, { once: true })
      child.once('close', () => options.signal?.removeEventListener('abort', onAbort))
      child.once('error', () => options.signal?.removeEventListener('abort', onAbort))
    }
  }

  return child
}

export function runTool(
  binaryPath: string,
  args: readonly string[],
  options?: { cwd?: string; signal?: AbortSignal; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawnTool(binaryPath, args, options)
    const max = options?.maxBuffer ?? 16 * 1024 * 1024
    let stdout = ''
    let stderr = ''
    let settled = false
    const abort = (): void => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
        reject(new DOMException('Operation cancelled.', 'AbortError'))
      }
    }
    if (options?.signal) {
      if (options.signal.aborted) abort()
      else options.signal.addEventListener('abort', abort, { once: true })
    }
    const cleanup = (): void => options?.signal?.removeEventListener('abort', abort)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > max) {
        child.kill('SIGTERM')
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error('Tool stdout exceeded maxBuffer'))
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > max) {
        child.kill('SIGTERM')
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error('Tool stderr exceeded maxBuffer'))
        }
      }
    })
    child.on('error', (err) => {
      if (!settled) {
        settled = true
        cleanup()
        reject(err)
      }
    })
    child.on('close', (code) => {
      if (!settled) {
        settled = true
        cleanup()
        resolve({ stdout, stderr, code: code ?? 1 })
      }
    })
  })
}

export function runToolBinary(
  binaryPath: string,
  args: readonly string[],
  options?: { cwd?: string; signal?: AbortSignal; maxBuffer?: number }
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawnTool(binaryPath, args, options)
    const max = options?.maxBuffer ?? 64 * 1024 * 1024
    const chunks: Buffer[] = []
    let total = 0
    let stderr = ''
    let stderrBytes = 0
    let settled = false
    const abort = (): void => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
        reject(new DOMException('Operation cancelled.', 'AbortError'))
      }
    }
    if (options?.signal) {
      if (options.signal.aborted) abort()
      else options.signal.addEventListener('abort', abort, { once: true })
    }
    const cleanup = (): void => options?.signal?.removeEventListener('abort', abort)

    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > max) {
        child.kill('SIGTERM')
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error('Tool stdout exceeded maxBuffer'))
        }
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > max) {
        child.kill('SIGTERM')
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error('Tool stderr exceeded maxBuffer'))
        }
        return
      }
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      if (!settled) {
        settled = true
        cleanup()
        reject(err)
      }
    })
    child.on('close', (code) => {
      if (!settled) {
        settled = true
        cleanup()
        resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 1 })
      }
    })
  })
}
