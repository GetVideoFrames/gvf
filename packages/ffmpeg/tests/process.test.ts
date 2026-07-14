import { describe, expect, it } from 'vitest'
import { runTool, runToolBinary } from '@gvf/ffmpeg'

describe('process cancellation and buffers', () => {
  it('rejects aborted tools with AbortError', async () => {
    const controller = new AbortController()
    const running = runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 20)
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('bounds stderr in binary mode', async () => {
    await expect(
      runToolBinary(process.execPath, ['-e', "process.stderr.write('x'.repeat(4096))"], {
        maxBuffer: 1024
      })
    ).rejects.toThrow('stderr exceeded maxBuffer')
  })
})
