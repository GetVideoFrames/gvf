import { describe, expect, it } from 'vitest'
import {
  buildExtractArgs,
  buildAllFramesArgs,
  buildExtractFrameArgs,
  buildFfprobeArgs,
  buildAnalysisDecodeArgs,
  displayDimensions,
  extensionForFormat,
  parseStreamRotation,
  buildFrameTimestampProbeArgs,
  parseFrameTimestamps
} from '@gvf/ffmpeg'

describe('FFmpeg argument construction', () => {
  it('builds ffprobe args as an explicit array without shell', () => {
    const args = buildFfprobeArgs('/Movies/clip.mp4')
    expect(args).toEqual([
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '/Movies/clip.mp4'
    ])
  })

  it('builds extract args with fps filter and jpeg quality', () => {
    const args = buildExtractArgs({
      inputPath: '/Movies/clip.mp4',
      outputPattern: '/out/frame_%06d.jpg',
      intervalSeconds: 2,
      format: 'image/jpeg',
      quality: 0.9,
      maxWidth: 1280
    })
    expect(args[0]).toBe('-hide_banner')
    expect(args).toContain('/Movies/clip.mp4')
    const vf = args[args.indexOf('-vf') + 1]
    expect(vf).toContain('fps=1/2')
    expect(vf).toContain("scale='min(1280,iw)':-2")
  })

  it('does not interpolate user paths into a shell string', () => {
    const evil = '/tmp/video; rm -rf /'
    const args = buildFfprobeArgs(evil)
    expect(args).toHaveLength(7)
    expect(args[6]).toBe(evil)
  })

  it('builds VFR-safe all-frame extraction without FPS resampling', () => {
    const args = buildAllFramesArgs({
      inputPath: '/Movies/clip.mp4',
      outputPattern: '/out/frame_%06d.jpg',
      format: 'image/jpeg',
      quality: 0.9,
      maxWidth: 640,
      rangeStartSec: 1,
      rangeEndSec: 3
    })
    expect(args).toContain('passthrough')
    expect(args.join(' ')).not.toContain('fps=')
    expect(args.join(' ')).toContain("scale='min(640,iw)':-2")
  })

  it('builds bounded range PTS probing and parses source timestamps', () => {
    const args = buildFrameTimestampProbeArgs({
      inputPath: 'vfr.mp4',
      fromSec: 1,
      toSec: 3
    })
    expect(args[args.indexOf('-read_intervals') + 1]).toBe('1%3')
    expect(args).toContain('frame=best_effort_timestamp_time')
    expect(
      parseFrameTimestamps(
        JSON.stringify({
          frames: [
            { best_effort_timestamp_time: '1.000000' },
            { best_effort_timestamp_time: '1.125000' }
          ]
        })
      )
    ).toEqual([1, 1.125])
  })

  it('maps formats and rotation-safe display dimensions', () => {
    expect(extensionForFormat('image/jpeg')).toBe('jpg')
    expect(parseStreamRotation({ side_data_list: [{ rotation: -90 }] })).toBe(-90)
    expect(displayDimensions(1920, 1080, -90)).toEqual({ width: 1080, height: 1920 })
  })

  it('builds analysis decode and single-frame export args', () => {
    const args = buildAnalysisDecodeArgs('/out/frame_%06d.jpg', 64, 36)
    expect(args).not.toContain('-frames:v')
    expect(args.at(-1)).toBe('pipe:1')
    const frame = buildExtractFrameArgs({
      inputPath: '/Movies/clip.mp4',
      outputPath: '/out/f.png',
      timeSec: 12.25,
      format: 'image/png',
      quality: 1,
      maxWidth: 1920
    })
    expect(frame[frame.indexOf('-ss') + 1]).toBe('12.25')
  })
})
