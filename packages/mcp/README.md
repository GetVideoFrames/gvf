# @gvf/mcp

Local **stdio** MCP server for GVF. Thin wrapper over `@gvf/core` handlers — never shells out to the CLI, never prompts, never installs runtimes.

## Tools

| Tool                                                                                     | Role                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------- |
| `gvf_run`                                                                                | **Recommended** high-level pipeline |
| `gvf_runtime_status`                                                                     | Diagnostics                         |
| `gvf_probe` / `gvf_extract` / `gvf_analyze` / `gvf_detect` / `gvf_select` / `gvf_export` | Advanced primitives                 |

Responses are bounded summaries + paths (not full frames JSONL).
`gvf_runtime_status`, `gvf_detect`, `gvf_select`, and `gvf_run` accept
`modelsDir`; use the same directory passed to CLI setup. MCP never prompts.

## Inspector and read-only evals

From the repository root:

```bash
npm run mcp:inspect
npm run mcp:fixtures
npm run mcp:eval:check
```

Inspector is pinned as a root dev dependency and launches the built local stdio
server. Fixtures are generated from FFmpeg lavfi under ignored `tmp/mcp-eval/`;
the 10 Q/A pairs in `docs/mcp-evals.xml` use only `gvf_runtime_status` and
`gvf_probe`. See `docs/MCP.md` for the resolved XML workflow.

## Config example

```json
{
  "mcpServers": {
    "gvf": {
      "command": "gvf-mcp"
    }
  }
}
```
