# Provenance & public-release blockers

## Contract status

Public JSON schemas are **`*/v1alpha1` (unstable)**. Do not advertise a frozen `v1`
API until validation completes and this document’s blockers are cleared.

## YOLOX-Nano (available)

| Field       | Value                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| File        | `yolox_nano.onnx`                                                                              |
| Release/tag | https://github.com/Megvii-BaseDetection/YOLOX/releases/tag/0.1.1rc0                            |
| Asset URL   | https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx       |
| Size        | `3,659,407` bytes                                                                              |
| SHA-256     | `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d`                             |
| License     | [Apache-2.0 at exact tag](https://github.com/Megvii-BaseDetection/YOLOX/blob/0.1.1rc0/LICENSE) |
| Status      | `available` via explicitly approved `gvf setup vision`                                         |

Weights are never committed. The guided plan is shown before network access; noninteractive setup requires `--yes`. Doctor verifies size, checksum, ONNX Runtime loading, and model loadability. Install lands under `~/.gvf/models/` (or `GVF_MODELS_DIR` / `--models-dir`).

This is a technical provenance inventory, not legal advice.

## Text detection (blocked)

Historical Desktop builds extracted `ch_PP-OCRv4_det_infer.onnx` from a RapidOCR PyPi wheel.
For the GVF open-source release:

- Redistribution rights and exact upstream ONNX export provenance are **not** independently verified.
- `packages/vision/model-manifest.json` marks the asset `status: "blocked"`.
- `gvf setup vision` will **not** download it.
- Every text predicate (`--text`, `--with-text`, `--without-text`, min/max coverage) fails with `TEXT_VISION_BLOCKED` unless verified analysis populated every frame. Missing metadata never means “no text.”
- Pure post-processing (`measureTextMap`, regions, coverage) and unit tests remain ready.

**Do not** claim text weights are available or Apache-licensed until legal/provenance review completes.

## FFmpeg managed sidecars (blocked)

Resolution order: explicit flags → env (`GVF_FFMPEG_PATH` / `GVF_FFPROBE_PATH`) → system `PATH` → verified managed sidecar fallback under `~/.gvf/runtime/ffmpeg/`.

`packages/ffmpeg/sidecar-manifest.json` documents per-platform entries. Today every platform is `status: "blocked"` — no approved public URL + SHA-256 for an LGPL build has been published for GVF OSS. `gvf setup ffmpeg` shows the plan and system package guidance; it does **not** download.

When provenance is approved, flip entries to `available` with `sourceUrl`, exact digests, license URL, and version — setup will then install after interactive/`--yes` confirmation. Never invent URLs or checksums.

## SBOM / license CI

`npm run sbom` emits a validated CycloneDX 1.6 SBOM. `npm run license:check` fails on unknown production dependency licenses.
They must not assert compliance for blocked vision assets or system/managed FFmpeg.
