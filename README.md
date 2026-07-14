# GVF

**Open-source video frame intelligence.**

Local CLI + stdio MCP for probing, analyzing, detecting, selecting, and exporting video frames — private by default, no telemetry, no uploads.

> Public contract: **`v1alpha1` (unstable)**. Not a frozen v1 release — see [docs/V1_READINESS.md](docs/V1_READINESS.md).

> Flagship command: **`gvf run`**. Primitives (`probe`, `extract`, `analyze`, `detect`, `select`, `export`) are for advanced control. Prefer `gvf run` unless you need the building blocks.

Want a visual studio with timelines and Smart Collections? Try **[GetVideoFrames Desktop](https://getvideoframes.com)** (commercial). [Join the GVF Cloud waitlist](https://getvideoframes.com) for updates — Cloud does not exist yet; this repo is the local OSS core.

## Requirements

- **Node.js ≥ 22**
- System **FFmpeg** + **ffprobe** on `PATH` (or `GVF_FFMPEG_PATH` / `GVF_FFPROBE_PATH`)
- Optional: `onnxruntime-node` + YOLOX-Nano weights for object detection (`gvf setup vision`)

## Install

```bash
git clone https://github.com/GetVideoFrames/gvf.git
cd gvf
npm install
npm run build
npm link -w @gvf/cli -w @gvf/mcp   # optional: gvf / gvf-mcp on PATH
```

Or run via workspace bins:

```bash
node packages/cli/bin/gvf.js doctor --pretty
```

## Quick start

```bash
# Runtime check
gvf doctor --pretty

# Flagship pipeline — select sharp people frames and export HQ JPEGs
gvf run video.mp4 --with person --rank sharpness --dedupe --best-per-scene 1 --export ./frames --pretty

# Presets
gvf run video.mp4 --preset storyboard --export ./storyboard
gvf run video.mp4 --preset people --export ./people
```

## CLI

All data commands print **versioned JSON on stdout**; progress/logs as JSONL on **stderr**. Use `--pretty` for human-readable JSON.

| Command                    | Purpose                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `gvf run`                  | **Flagship** analyze/detect → select → optional HQ export                           |
| `gvf doctor`               | Inspect FFmpeg + vision                                                             |
| `gvf setup ffmpeg\|vision` | Guided runtime setup (no binaries in npm; FFmpeg sidecars blocked until provenance) |
| `gvf probe`                | Probe metadata (rotation-safe)                                                      |
| `gvf extract`              | Deterministic extraction; `--candidates` for workspace                              |
| `gvf analyze`              | Scene / sharpness / exposure / duplicates                                           |
| `gvf detect`               | YOLOX COCO objects (`--object`, `--group`, `--people`)                              |
| `gvf select`               | Write `selections.json` with reasons (no export)                                    |
| `gvf export`               | Re-extract selected timestamps at final quality                                     |

Sampling (exactly one): `--every`, `--fps`, `--count`, repeated `--at`, or `--all`, plus `--from` / `--to`. Default candidates: **0.5s** interval, budget **1200**.

`extract --all` uses decoded-frame passthrough (including VFR), reads exact source PTS with ffprobe, preflights size, and asks in a TTY; CI needs `--force`. Smart/candidate `--all` fails if emitted frames cannot be mapped exactly to source PTS. Direct extraction records an explicit `estimated-fps` fallback only when exact PTS is unavailable. There is no artificial cap with `--force`; an explicit `--max-output-frames` remains a hard cap.

Output/workspace/export directories must be fresh or empty. `--overwrite` permits GVF/exact export target replacement and never recursively deletes a directory or unrelated files. Batch inputs are isolated in collision-safe source subfolders.

Direct extraction writes `manifest.json` (`gvf.extract-manifest/v1alpha1`) and `frames.jsonl` beside the frame assets. CLI/MCP responses are bounded summaries (counts, artifact paths, and at most 20 samples); Core arrays remain available for programmatic callers.

## MCP (local stdio)

```json
{
  "mcpServers": {
    "gvf": {
      "command": "gvf-mcp"
    }
  }
}
```

Tools: `gvf_run` (recommended), plus primitives and `gvf_runtime_status`. Never prompts or installs. See [docs/MCP.md](docs/MCP.md).

For local MCP development: `npm run mcp:inspect` launches pinned Inspector 0.22.0
against the built stdio server; `npm run mcp:fixtures` generates ignored lavfi
fixtures; and `npm run mcp:eval:check` validates the 10 read-only Q/A pairs.

## Privacy

- **No telemetry** in Core / CLI / MCP
- Local processing only — frames and models stay on your machine
- MIT applies to GVF-owned source; third-party assets have separate licenses ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md))

## Architecture

```
packages/core     handlers, workspace gvf.manifest/v1alpha1, smart analysis, selection
packages/cli      gvf binary
packages/mcp      gvf-mcp stdio server (calls Core, not CLI)
packages/ffmpeg   resolve/spawn/args + blocked-until-approved sidecar setup
packages/vision   YOLOX provider, COCO labels, text interfaces (text weights blocked)
```

Two-phase design: bounded low-res **candidates** for analysis → selected timestamps **re-extracted** from source at export quality.

Workspace layout:

```
workspace/manifest.json    # gvf.manifest/v1alpha1 (unstable)
workspace/frames.jsonl     # one frame record per line (relative paths when possible)
workspace/selections.json
workspace/frames/          # candidate assets
```

Workspace-owned artifact paths are relative when possible. The source video is
recorded as a canonical absolute path and is not portable with the workspace.

## Vision notes

- Default object provider: **YOLOX-Nano** (Apache-2.0 upstream) via optional `onnxruntime-node`
- All **80 COCO** classes + groups `people|animals|vehicles|products` (`products` = curated subset)
- Object detection persists all model detections for every candidate frame; query filters affect summaries/selections, not stored completeness.
- Detection persistence uses the requested `--min-confidence` (default `0.4`, minimum `0.01`) and records it in the workspace. Selection reuses data only when the stored threshold is low enough.
- Text: presence/regions/coverage APIs ready; **weight download blocked** until provenance is verified ([docs/PROVENANCE.md](docs/PROVENANCE.md)). Every text predicate, including `--without-text` and coverage filters, returns `TEXT_VISION_BLOCKED` unless a verified provider populated every frame. Unanalyzed never means “no text.”

`gvf setup vision` prints the audited origin/license/checksum/destination plan and asks before downloading. Noninteractive setup requires `--yes`; MCP never installs. `gvf doctor` verifies size, SHA-256, ONNX Runtime availability, and model loadability.

Use `--models-dir <path>` consistently with `setup`, `doctor`, `detect`, `select`,
and `run`, or set `GVF_MODELS_DIR`.

Presets merge only explicitly supplied overrides, so absent CLI flags preserve preset ranking/dedupe/scene defaults.

## Commercial boundaries

|           | OSS GVF         | GetVideoFrames Desktop | Future GVF Cloud |
| --------- | --------------- | ---------------------- | ---------------- |
| License   | MIT (this repo) | Proprietary            | TBD              |
| UI        | CLI + MCP       | Visual studio          | Managed API      |
| Telemetry | None            | Product analytics      | TBD              |

## Development

The repo intentionally pins TypeScript 5.9: TypeScript 7 is not yet a safe upgrade for the current `typescript-eslint` toolchain.

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run audit
npm run sbom
npm run license:check
npm run pack:check
```

## License

[MIT](LICENSE) — GVF-owned source only. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[docs/OWNERSHIP.md](docs/OWNERSHIP.md), [docs/PROVENANCE.md](docs/PROVENANCE.md), and
[docs/V1_READINESS.md](docs/V1_READINESS.md).
