#!/usr/bin/env node
/**
 * Lightweight, dependency-free guard for the MCP Builder evaluation artifact.
 */

import { readFile } from 'node:fs/promises'

const evalPath = new URL('../docs/mcp-evals.xml', import.meta.url)
const xml = await readFile(evalPath, 'utf8')
const allowedTools = new Set(['gvf_runtime_status', 'gvf_probe'])
const pairs = [...xml.matchAll(/<qa_pair>([\s\S]*?)<\/qa_pair>/g)]

if (!/<evaluation>[\s\S]*<\/evaluation>\s*$/.test(xml)) {
  throw new Error('MCP eval XML must have one <evaluation> root.')
}
if (pairs.length !== 10) {
  throw new Error(
    `MCP eval XML must contain exactly 10 qa_pair entries; got ${pairs.length}.`
  )
}

for (const [index, pair] of pairs.entries()) {
  const body = pair[1] ?? ''
  const question = body.match(/<question>([\s\S]*?)<\/question>/)?.[1]?.trim()
  const answer = body.match(/<answer>([\s\S]*?)<\/answer>/)?.[1]?.trim()
  if (!question || !answer) {
    throw new Error(`MCP eval pair ${index + 1} needs one non-empty question and answer.`)
  }
  const tools = new Set(body.match(/\bgvf_[a-z_]+\b/g) ?? [])
  if (tools.size === 0) {
    throw new Error(`MCP eval pair ${index + 1} must reference a read-only tool.`)
  }
  for (const tool of tools) {
    if (!allowedTools.has(tool)) {
      throw new Error(
        `MCP eval pair ${index + 1} references non-read-only or unknown tool ${tool}.`
      )
    }
  }
}

const allToolReferences = [...new Set(xml.match(/\bgvf_[a-z_]+\b/g) ?? [])]
console.log(
  `MCP eval check OK: ${pairs.length} independent pairs; tools: ${allToolReferences.join(', ')}.`
)
