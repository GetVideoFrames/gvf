# MCP smoke / Inspector notes

## Start

```bash
npm install
npm run build
gvf-mcp
```

## Inspector

The root pins `@modelcontextprotocol/inspector@0.22.0` as a dev dependency.
Build the local stdio server and launch the Inspector with:

```bash
npm run mcp:inspect
```

Equivalent exact command after `npm run build -w @gvf/mcp`:

```bash
./node_modules/.bin/mcp-inspector node ./packages/mcp/bin/gvf-mcp.js
```

The Inspector UI/proxy and GVF server are local. GVF still performs no telemetry,
uploads, or remote API calls.

## Expected tools

- `gvf_run` — recommended
- Primitives: `gvf_probe`, `gvf_extract`, `gvf_analyze`, `gvf_detect`, `gvf_select`, `gvf_export`
- `gvf_runtime_status` — read-only diagnostics

## Evaluation checklist

1. `gvf_runtime_status` returns ffmpeg/vision status without installing.
2. Missing vision → tool error includes `gvf setup vision` guidance (no prompt).
3. `gvf_run` on a short local file returns workspace + selection summary (bounded).
4. Responses never dump full `frames.jsonl` into the model context.
5. Tools are registered with SDK v1.29 `McpServer.registerTool`, strict Zod v4 schemas, annotations, output schemas, and bounded `structuredContent`.
6. Sampling, extraction, detection, selection, export, and run options match Core. MCP is always noninteractive and never installs.
7. Extract responses expose direct/workspace manifest and JSONL paths; frame/selection/export arrays are bounded samples.
8. Export and run accept `overwrite`; default non-empty outputs return `GUARD`, while overwrite preserves unrelated files.
9. Detection confidence is `0.01..1`; complete workspaces record their persistence threshold.
10. Runtime status, detect, select, and run accept `modelsDir`; setup remains a CLI action and MCP never prompts.

The automated protocol smoke test uses an MCP `Client` over linked in-memory transports to list tools, call `gvf_runtime_status`, and verify strict input rejection.

## Read-only evaluations

`docs/mcp-evals.xml` contains exactly 10 independent MCP Builder Q/A pairs. They
reference only `gvf_runtime_status` and `gvf_probe`.

Generate deterministic local inputs from FFmpeg lavfi:

```bash
npm run mcp:fixtures
```

This recreates `tmp/mcp-eval/` with four videos and writes
`tmp/mcp-eval/mcp-evals.resolved.xml`, replacing every `{{FIXTURES_DIR}}`
placeholder with the absolute generated directory. `tmp/` is gitignored; no media,
binaries, or generated eval reports are committed.

To use another ignored destination:

```bash
npm run mcp:fixtures -- ./tmp/my-mcp-eval
```

Open Inspector with `npm run mcp:inspect`, then execute each question from the
resolved XML. The expected answer is directly adjacent in its `<qa_pair>`. These
evaluations are read-only and must not invoke extract/analyze/detect/select/export/run.

Validate the checked-in evaluation contract:

```bash
npm run mcp:eval:check
```

This check is also run by `npm test`. It parses the XML, requires exactly 10
non-empty Q/A pairs, and fails if any referenced tool is not
`gvf_runtime_status` or `gvf_probe`.
