import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  DEFAULT_ALL_FRAME_WARN,
  estimateFrameCount,
  GvfError
} from '@gvf/core'
import { Command } from 'commander'
import { boundedFrames, commandOptions, runCli, selectFromOpts } from '@gvf/cli'

async function parseActionOptions(
  commandName: 'detect' | 'select' | 'run',
  argv: string[]
): Promise<{ input: string; opts: Record<string, unknown> }> {
  const program = new Command().exitOverride()
  program
    .option('--models-dir <dir>')
    .option('--ffmpeg <path>')
    .option('--ffprobe <path>')
    .option('--pretty')
  const subcommand = program
    .command(`${commandName} <input>`)
    .option('--models-dir <dir>')
    .option('--ffmpeg <path>')
    .option('--ffprobe <path>')
    .option('--pretty')
    .option('--count <n>')
  let captured: { input: string; opts: Record<string, unknown> } | undefined
  subcommand.action((input: string, _opts, command) => {
    captured = { input, opts: commandOptions(command) }
  })
  await program.parseAsync(['node', 'gvf', ...argv])
  return captured!
}

describe('extract --all guards', () => {
  it('estimates all-frame counts from fps and range', () => {
    expect(
      estimateFrameCount({
        durationSec: 10,
        fps: 30,
        strategy: 'all'
      })
    ).toBe(300)
  })

  it('documents default warn threshold', () => {
    expect(DEFAULT_ALL_FRAME_WARN).toBe(5000)
  })

  it('GvfError guard exit code is stable', () => {
    const err = new GvfError('GUARD', 'too many frames')
    expect(err.exitCode).toBe(7)
  })

  it('returns USAGE for an invalid output format before probing', async () => {
    expect(
      await runCli(['node', 'gvf', 'extract', '/missing.mp4', '--format', 'gif'])
    ).toBe(2)
  })

  it('preserves preset values when CLI flags are absent', () => {
    const cliOptions = selectFromOpts({
      with: [],
      withAny: [],
      without: [],
      withText: false,
      withoutText: false,
      dedupe: false
    })
    expect(applyPreset('storyboard', cliOptions)).toMatchObject({
      rank: 'sharpness',
      dedupe: true,
      bestPerScene: 1
    })
  })

  it('bounds frame samples while preserving total count', () => {
    const frames = Array.from({ length: 25 }, (_, index) => ({
      id: String(index),
      timeSec: index,
      path: `/frame-${index}.jpg`
    }))
    expect(boundedFrames(frames)).toMatchObject({ count: 25 })
    expect(boundedFrames(frames).sample).toHaveLength(20)
  })

  it.each(['detect', 'select', 'run'] as const)(
    'merges globals for %s before or after the subcommand',
    async (commandName) => {
      const before = await parseActionOptions(commandName, [
        '--models-dir',
        '/tmp/models-before',
        '--ffmpeg',
        '/tmp/ffmpeg-before',
        commandName,
        'video.mp4',
        '--count',
        '2'
      ])
      expect(before).toMatchObject({
        input: 'video.mp4',
        opts: {
          modelsDir: '/tmp/models-before',
          ffmpeg: '/tmp/ffmpeg-before',
          count: '2'
        }
      })

      const after = await parseActionOptions(commandName, [
        commandName,
        'video.mp4',
        '--count',
        '3',
        '--models-dir',
        '/tmp/models-after',
        '--ffprobe',
        '/tmp/ffprobe-after',
        '--pretty'
      ])
      expect(after).toMatchObject({
        input: 'video.mp4',
        opts: {
          modelsDir: '/tmp/models-after',
          ffprobe: '/tmp/ffprobe-after',
          pretty: true,
          count: '3'
        }
      })
    }
  )
})
