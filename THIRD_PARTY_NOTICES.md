# Third-party notices

This file covers **dependencies and external runtime assets** used by GVF.
The MIT license in `LICENSE` applies only to **GVF-owned source** in this repository.

## npm dependencies (selected)

| Package                                 | License                  | Notes                          |
| --------------------------------------- | ------------------------ | ------------------------------ |
| zod                                     | MIT                      | Schema validation              |
| commander                               | MIT                      | CLI                            |
| @modelcontextprotocol/sdk               | MIT                      | MCP stdio server               |
| onnxruntime-node                        | MIT                      | Optional ONNX Runtime (vision) |
| vitest / typescript / eslint / prettier | Various (MIT/Apache-2.0) | Dev tooling                    |

Generate a full inventory in CI with `npm run sbom` and `npm run license:check`.

## Runtime assets (not shipped in git/npm)

### FFmpeg / ffprobe

- **Not packaged** in npm. Resolved from explicit flags, env, system PATH, then an
  optional verified managed sidecar fallback (`~/.gvf/runtime/ffmpeg/`).
- Managed sidecar downloads are **blocked** until per-platform URL + SHA-256 + LGPL
  provenance are approved (`packages/ffmpeg/sidecar-manifest.json`).
- System packages and builds carry their own licenses (often LGPL/GPL depending on build).
- GVF does not claim any FFmpeg binary is LGPL unless you verify it yourself.

### YOLOX-Nano (`yolox_nano.onnx`)

- Origin: [Megvii YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) release `0.1.1rc0`
- Asset: exactly 3,659,407 bytes; SHA-256 `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d`
- License: [Apache-2.0 at exact upstream tag](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.1.1rc0/LICENSE)
- Downloaded only after guided approval and verified against `packages/vision/model-manifest.json`
- This technical inventory is not legal advice.

### Text detection ONNX (PP-OCRv4 det)

- **Blocked** for public download/setup until redistribution provenance is verified.
- See `docs/PROVENANCE.md` and `model-manifest.json` (`status: blocked`).

## No telemetry

GVF Core, CLI, and MCP contain **no telemetry**, analytics, or upload pipelines.
Processing is local/private unless you choose to send outputs elsewhere.
