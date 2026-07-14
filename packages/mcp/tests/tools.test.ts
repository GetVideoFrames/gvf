import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createGvfMcpServer, TOOL_NAMES } from '@gvf/mcp'

const close: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(close.splice(0).map((fn) => fn()))
})

describe('MCP protocol', () => {
  it('lists modern registered tools and calls runtime status', async () => {
    const server = createGvfMcpServer()
    const client = new Client({ name: 'gvf-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    close.push(
      () => client.close(),
      () => server.close()
    )

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES])
    expect(listed.tools.find((tool) => tool.name === 'gvf_run')?.description).toContain(
      'RECOMMENDED'
    )

    const called = await client.callTool({ name: 'gvf_runtime_status', arguments: {} })
    expect(called.isError).not.toBe(true)
    expect(called.structuredContent).toMatchObject({
      result: { schema: 'gvf.runtime/v1alpha1' }
    })

    const custom = await client.callTool({
      name: 'gvf_runtime_status',
      arguments: { modelsDir: '/tmp/gvf-custom-models' }
    })
    expect(custom.structuredContent).toMatchObject({
      result: { vision: { modelsDir: '/tmp/gvf-custom-models' } }
    })
  })

  it('rejects unknown input fields through strict schemas', async () => {
    const server = createGvfMcpServer()
    const client = new Client({ name: 'gvf-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    close.push(
      () => client.close(),
      () => server.close()
    )

    const result = await client.callTool({
      name: 'gvf_runtime_status',
      arguments: { unexpected: true }
    })
    expect(result.isError).toBe(true)
  })
})
