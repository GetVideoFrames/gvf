---
name: gvf-cli-mcp
description: Architecture, contracts, setup, and provenance rules for the GVF open-source CLI and local MCP. Use when changing Core handlers, workspace schema, CLI/MCP surfaces, FFmpeg resolution, or vision models.
---

# GVF CLI / MCP

## Product

- **GVF** — “Open-source video frame intelligence.”
- Surfaces: CLI (`gvf`) and local stdio MCP (`gvf-mcp`).
- Flagship: `gvf run` / tool `gvf_run`. Primitives are advanced control.
- No telemetry. Local/private processing only.
- MIT for GVF-owned source. Desktop/auth/PostHog/Cloud stay private.
- Public contract is **`v1alpha1` / unstable** until validation — do not freeze `v1` early.

## Packages

| Package       | Role                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `@gvf/core`   | Handlers, `gvf.manifest/v1alpha1` workspace, smart analysis, selection |
| `@gvf/cli`    | Commander CLI → Core                                                   |
| `@gvf/mcp`    | MCP SDK → Core (never shell out to CLI)                                |
| `@gvf/ffmpeg` | Resolve/spawn/args + blocked-until-approved sidecar setup              |
| `@gvf/vision` | YOLOX provider, COCO/groups, text interfaces                           |

Node **≥ 22**. Workspaces via npm.

## Workspace contract (`gvf.manifest/v1alpha1`)

```
manifest.json   source/probe/sampling/providers/artifacts
frames.jsonl    one FrameRecord per line (workspace-owned paths relative)
selections.json explainable picks (no implicit export)
frames/         candidate assets
```

Two-phase: low-res candidates → HQ re-extract of selected timestamps.

Default sampling: end-exclusive interval **0.5s**, budget **1200**. Candidate max width is **640**. If capped, `equalDensity: false`. Direct `--all` uses decoded-frame passthrough and has no artificial cap with `--force`; explicit `--max-output-frames` is always hard.

Fresh/empty outputs are required. `--overwrite` removes only GVF frame targets and preserves unrelated files. Batch inputs use collision-safe source subfolders; workspace names use UUIDs.

Direct extraction writes `gvf.extract-manifest/v1alpha1` `manifest.json` + `frames.jsonl`. CLI/MCP return bounded summaries and artifact paths; Core may retain arrays for programmatic composition. Export/run also require fresh/empty output unless `--overwrite`, which replaces exact targets without deleting unrelated files.

All-frame smart timestamps use ffprobe `best_effort_timestamp_time` (`timestampBasis: source-pts`). Candidate `--all` fails on timestamp/count ambiguity; direct final extraction may explicitly record `estimated-fps` fallback.

## Commands / tools

`setupRuntime`/`doctor`, `probe`, `extract`, `analyze`, `detect`, `select`, `export`, `run`.

Stdout = versioned JSON; stderr = progress JSONL. Shared sampling: exactly one of `--every|--fps|--count|--at|--all`.

Presets (real aliases only): `representative`, `storyboard`, `people`. Do not add marketing fiction presets.

## Vision provenance

- YOLOX-Nano: guided, explicit download with exact size + SHA-256 from `model-manifest.json`; doctor verifies ONNX Runtime/model loading.
- Persist all object detections above requested confidence (default 0.4, minimum 0.01), record the threshold, and mark `detectionsComplete`; query filters only summarize/select. Reuse only when stored threshold ≤ requested threshold.
- Text weights: **blocked** until provenance verified — do not enable download or claim availability.
- Every text predicate fails unless verified text analysis populated every frame. Never infer no text from absent metadata.
- No weights in git/npm. `onnxruntime-node` is optional.

## FFmpeg

Resolve: explicit flags → env → system PATH → verified managed sidecar fallback (`~/.gvf/runtime/ffmpeg/`).
Never package binaries in npm. `gvf setup ffmpeg` shows source/license/checksum/destination; downloads only when `sidecar-manifest.json` marks the platform `available`. Today all platforms are **blocked** — setup returns system install guidance. Treat setup as runtime management, not MIT GVF code.

## MCP rules

- SDK v1.29 `McpServer.registerTool`, strict Zod v4 schemas, bounded structured output.
- Same Core handlers/options as CLI.
- `gvf_run` description must say recommended.
- Bounded responses (summaries + paths).
- Never prompt/install; return setup hints.
- Annotations: readOnly/destructive/idempotent/openWorld.

## Inspector and evaluations

- `npm run mcp:inspect` builds MCP and launches pinned Inspector 0.22.0 against
  `node ./packages/mcp/bin/gvf-mcp.js` over local stdio.
- `npm run mcp:fixtures` creates deterministic lavfi videos and a path-resolved
  eval XML under ignored `tmp/mcp-eval/`; never commit generated media.
- `docs/mcp-evals.xml` contains exactly 10 independent MCP Builder Q/A pairs
  using only read-only `gvf_runtime_status` and `gvf_probe`.
- `npm run mcp:eval:check` validates pair count/content/tool references and runs
  automatically before Vitest through `npm test`.

## Release blockers

See `docs/PROVENANCE.md` and `docs/V1_READINESS.md`: text weights + platform FFmpeg sidecars + contract freeze.

## When changing behavior

1. Update Core handler + Zod schemas first.
2. Wire CLI and MCP to the same options.
3. Add/adjust unit tests; keep E2E skip-when-no-ffmpeg.
4. Update `docs/PROVENANCE.md` / manifests if assets change.
5. Do not copy Desktop Electron/auth/analytics code.

Preset merging ignores only `undefined`; explicit `false` is a real override.
