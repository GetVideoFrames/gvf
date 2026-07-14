/** Modern local stdio MCP server. Calls Core directly; never prompts or installs. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod/v4'
import {
  analyzeFrames,
  detectFrames,
  exportFrames,
  extractFrames,
  inspectRuntime,
  probeVideos,
  runPipeline,
  selectFrames,
  toGvfError
} from '@gvf/core'

const BoundedOutputSchema = {
  result: z.record(z.string(), z.unknown())
}

function toolResult(data: Record<string, unknown>, isError = false): CallToolResult {
  const structuredContent = { result: data }
  const result: CallToolResult = {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent
  }
  if (isError) result.isError = true
  return result
}

function summarizeFrames(frames: Array<{ id: string; timeSec: number; path: string }>) {
  return {
    count: frames.length,
    sample: frames.slice(0, 5).map(({ id, timeSec, path }) => ({ id, timeSec, path })),
    note: 'Bounded summary; full records live in the manifest-linked frames.jsonl artifact.'
  }
}

const annotations = (readOnly: boolean) => ({
  readOnlyHint: readOnly,
  destructiveHint: false,
  idempotentHint: readOnly,
  openWorldHint: false
})
const pathString = z.string().min(1)
const unit = z.number().finite().min(0).max(1)
const confidence = z.number().finite().min(0.01).max(1)
const positive = z.number().finite().positive()
const positiveInt = z.number().int().positive()
const format = z.enum(['jpeg', 'png', 'webp']).optional()
const formatValue = (value: 'jpeg' | 'png' | 'webp' | undefined) =>
  value === 'png'
    ? ('image/png' as const)
    : value === 'webp'
      ? ('image/webp' as const)
      : ('image/jpeg' as const)

const SamplingFields = {
  every: positive.optional(),
  fps: positive.optional(),
  count: positiveInt.optional(),
  at: z.array(z.number().finite().nonnegative()).optional(),
  all: z.boolean().optional(),
  from: z.number().finite().nonnegative().optional(),
  to: positive.optional(),
  budget: positiveInt.optional()
}
const SelectionFields = {
  with: z.array(z.string().min(1)).optional(),
  withAny: z.array(z.string().min(1)).optional(),
  without: z.array(z.string().min(1)).optional(),
  withText: z.boolean().optional(),
  withoutText: z.boolean().optional(),
  minTextCoverage: unit.optional(),
  maxTextCoverage: unit.optional(),
  minConfidence: confidence.optional(),
  minQuality: unit.optional(),
  rank: z.enum(['quality', 'sharpness', 'exposure']).optional(),
  dedupe: z.boolean().optional(),
  bestPerScene: positiveInt.optional(),
  limit: positiveInt.optional(),
  preset: z.enum(['representative', 'storyboard', 'people']).optional()
}

export const TOOL_NAMES = [
  'gvf_runtime_status',
  'gvf_probe',
  'gvf_extract',
  'gvf_analyze',
  'gvf_detect',
  'gvf_select',
  'gvf_export',
  'gvf_run'
] as const

export function createGvfMcpServer(): McpServer {
  const server = new McpServer({ name: 'gvf', version: '0.1.0' })

  function register<T extends z.ZodType<Record<string, unknown>>>(
    name: (typeof TOOL_NAMES)[number],
    description: string,
    inputSchema: T,
    readOnly: boolean,
    handler: (args: z.output<T>) => Promise<Record<string, unknown>>
  ): void {
    const callback = async (args: z.output<T>): Promise<CallToolResult> => {
      try {
        return toolResult(await handler(args))
      } catch (error) {
        return toolResult(toGvfError(error).toJSON(), true)
      }
    }
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        outputSchema: BoundedOutputSchema,
        annotations: annotations(readOnly)
      },
      callback as never
    )
  }

  register(
    'gvf_runtime_status',
    'Inspect local runtime without installing anything. Advanced diagnostics.',
    z.strictObject({ modelsDir: pathString.optional() }),
    true,
    async ({ modelsDir }) => ({ ...(await inspectRuntime({ modelsDir })) })
  )
  register(
    'gvf_probe',
    'Probe rotation-safe metadata. Advanced primitive; prefer gvf_run.',
    z.strictObject({ inputs: z.array(pathString).min(1) }),
    true,
    async ({ inputs }) => probeVideos(inputs)
  )
  register(
    'gvf_extract',
    'Extract final frames or a candidate workspace. Advanced primitive; never prompts.',
    z.strictObject({
      input: pathString,
      ...SamplingFields,
      output: pathString.optional(),
      workspace: pathString.optional(),
      candidates: z.boolean().optional(),
      format,
      quality: unit.optional(),
      maxWidth: positiveInt.optional(),
      filenameTemplate: z.string().optional(),
      force: z.boolean().optional(),
      overwrite: z.boolean().optional(),
      maxOutputFrames: positiveInt.optional()
    }),
    false,
    async ({ input, format: outputFormat, ...args }) => {
      const result = await extractFrames(input, {
        ...args,
        format: formatValue(outputFormat),
        interactive: false
      })
      return {
        schema: result.schema,
        command: result.command,
        workspace: result.workspace,
        outputDir: result.outputDir,
        sampling: result.sampling,
        manifestPath: result.manifestPath,
        framesPath: result.framesPath,
        frames: summarizeFrames(result.frames)
      }
    }
  )
  register(
    'gvf_analyze',
    'Analyze scene, quality, similarity, and duplicates. Advanced primitive.',
    z.strictObject({
      input: pathString,
      workspace: pathString.optional(),
      ...SamplingFields
    }),
    false,
    async ({ input, ...args }) => {
      const result = await analyzeFrames(input, args)
      return {
        schema: result.schema,
        command: result.command,
        workspace: result.workspace,
        summary: result.summary,
        frames: summarizeFrames(result.frames)
      }
    }
  )
  register(
    'gvf_detect',
    'Persist complete COCO detections. Advanced primitive; never installs models.',
    z.strictObject({
      input: pathString,
      workspace: pathString.optional(),
      ...SamplingFields,
      object: z.array(z.string().min(1)).optional(),
      group: z.array(z.enum(['people', 'animals', 'vehicles', 'products'])).optional(),
      people: z.boolean().optional(),
      text: z.boolean().optional(),
      minConfidence: confidence.optional(),
      modelsDir: pathString.optional()
    }),
    false,
    async ({ input, ...args }) => {
      const result = await detectFrames(input, { ...args, interactive: false })
      return {
        schema: result.schema,
        command: result.command,
        workspace: result.workspace,
        summary: result.summary,
        frames: summarizeFrames(result.frames)
      }
    }
  )
  register(
    'gvf_select',
    'Write explainable selections.json without exporting. Advanced primitive.',
    z.strictObject({
      input: pathString,
      workspace: pathString.optional(),
      ...SamplingFields,
      ...SelectionFields,
      modelsDir: pathString.optional()
    }),
    false,
    async ({ input, ...args }) => {
      const result = await selectFrames(input, { ...args, interactive: false })
      return {
        schema: result.schema,
        command: result.command,
        workspace: result.workspace,
        selectionsPath: result.selectionsPath,
        selectionCount: result.selections.selections.length,
        selections: result.selections.selections.slice(0, 20)
      }
    }
  )
  register(
    'gvf_export',
    'Re-extract selected timestamps from the matching source. Advanced primitive.',
    z.strictObject({
      input: pathString,
      selection: pathString,
      output: pathString,
      workspace: pathString.optional(),
      format,
      quality: unit.optional(),
      maxWidth: positiveInt.optional(),
      filenameTemplate: z.string().optional(),
      overwrite: z.boolean().optional()
    }),
    false,
    async ({ input, format: outputFormat, ...args }) => {
      const result = await exportFrames(input, {
        ...args,
        format: formatValue(outputFormat)
      })
      return {
        schema: result.schema,
        command: result.command,
        outputDir: result.outputDir,
        exportedCount: result.exported.length,
        manifestPath: result.manifestPath,
        sample: result.exported.slice(0, 5)
      }
    }
  )
  register(
    'gvf_run',
    'RECOMMENDED high-level tool: analyze/detect as needed, select, and optionally HQ export.',
    z.strictObject({
      input: pathString,
      workspace: pathString.optional(),
      ...SamplingFields,
      ...SelectionFields,
      export: pathString.optional(),
      format,
      quality: unit.optional(),
      maxWidth: positiveInt.optional(),
      filenameTemplate: z.string().optional(),
      overwrite: z.boolean().optional(),
      modelsDir: pathString.optional()
    }),
    false,
    async ({ input, format: outputFormat, ...args }) =>
      runPipeline(input, {
        ...args,
        format: formatValue(outputFormat),
        interactive: false
      })
  )

  return server
}

export async function startMcpServer(): Promise<void> {
  const server = createGvfMcpServer()
  await server.connect(new StdioServerTransport())
}

export { TOOL_NAMES as tools }
