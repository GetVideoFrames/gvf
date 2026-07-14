import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@gvf/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@gvf/ffmpeg': resolve(__dirname, 'packages/ffmpeg/src/index.ts'),
      '@gvf/vision': resolve(__dirname, 'packages/vision/src/index.ts'),
      '@gvf/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
      '@gvf/mcp': resolve(__dirname, 'packages/mcp/src/index.ts')
    }
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
