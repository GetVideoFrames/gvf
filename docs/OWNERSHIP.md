# Ownership & provenance inventory

## GVF-owned source (MIT)

All TypeScript/JavaScript under `packages/*` and docs/scripts in this repo, unless noted.

## Extracted / adapted from GetVideoFrames Desktop (private product)

Refactored into GVF-owned modules with Electron, auth, licensing, PostHog, queue, and
cloud coupling removed. Logic remains GVF/Achieve Apex owned; published under MIT here.

| Desktop path                                  | GVF path                                  | Notes                            |
| --------------------------------------------- | ----------------------------------------- | -------------------------------- |
| `src/shared/smart/*`                          | `packages/core/src/smart/*`               | Scene/blur/exposure/dHash/Pareto |
| `src/shared/naming.ts`                        | `packages/core/src/naming.ts`             | Filename templates               |
| `src/shared/detect/yolox.ts`                  | `packages/vision/src/providers/yolox.ts`  | Extended to all 80 COCO classes  |
| `src/shared/detect/textmap.ts`                | `packages/vision/src/text/textmap.ts`     | Extended with regions            |
| `src/shared/detect/coco-labels.ts`            | `packages/vision/src/labels/coco.ts`      | Full 80-class table + groups     |
| `src/main/services/probe.ts` (arg builders)   | `packages/ffmpeg/src/args.ts`             | Rotation-safe probe/extract args |
| `src/main/services/ffmpeg.ts` (spawn/runTool) | `packages/ffmpeg/src/process.ts`          | No Electron                      |
| `src/main/services/smart.ts` (decode args)    | `packages/ffmpeg/src/args.ts`             | Analysis decode args             |
| `scripts/fetch-models.mjs`                    | `packages/vision/src/setup.ts` + manifest | YOLOX only; text blocked         |

## Intentionally NOT copied

- Electron main/preload/renderer
- Auth, entitlements, licensing, credentials
- PostHog / analytics
- Cloud API clients
- Job queue / IPC / persistence product layer
- Packaged FFmpeg sidecar binaries and checksum gate for Electron bundles

## Public-release blockers

1. **Text detection weights** — provenance/redistribution not verified → setup blocked.
2. **Managed FFmpeg platform sidecars** — no approved URL/SHA-256 yet → `sidecar-manifest.json` blocked; system FFmpeg works.
3. Do not generate SBOMs or license reports that claim text-model or unmanaged FFmpeg compliance.
4. Public schemas remain `*/v1alpha1` until blockers clear — see `docs/V1_READINESS.md`.

## Runtime and data boundaries

- Core, CLI, and MCP contain no telemetry or uploads.
- FFmpeg resolution is explicit/env → system PATH → verified managed sidecar fallback; no FFmpeg executable is packed in npm.
- Vision setup is explicit and checksum-gated; MCP never installs.
- Object runs persist complete model output per candidate frame and mark completeness in the workspace manifest.
- Text metadata is never synthesized from absence; all text predicates remain blocked without verified complete analysis.
- Workspaces use UUID names and atomic metadata writes; workspace-owned frame paths are relative when possible.
- Source video identity is a canonical absolute path. Source assets are not portable with the workspace.
