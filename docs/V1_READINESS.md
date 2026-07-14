# v1 readiness (not a stable release)

GVF currently ships an **unstable `v1alpha1` public contract**. This is intentionally
not a frozen `v1` API.

## Ready today (local OSS core)

- Vertical slice: probe → candidates → analyze → select → HQ export
- CLI primitives + flagship `gvf run` with presets `representative|storyboard|people`
- Local stdio MCP calling Core directly (`gvf_run` recommended)
- Workspace artifacts: `manifest.json` + `frames.jsonl` + `selections.json` + `frames/`
- Sampling: every/fps/count/at/all + from/to; default candidates 0.5s / budget 1200
- `extract --all` preflight + TTY confirm / noninteractive `--force` + `--max-output-frames`
- YOLOX-Nano object detection (guided setup) with all 80 COCO classes + group aliases
- No telemetry / no uploads
- Supply-chain scripts: format, lint, typecheck, tests, pack dry-run, SBOM, license check

## Public-release blockers

1. **Text detection weights** — provenance/redistribution unverified (`status: blocked`).
2. **Managed FFmpeg platform sidecars** — URLs/SHA-256 not approved (`sidecar-manifest.json` blocked); system FFmpeg works.
3. **Contract freeze** — keep `*/v1alpha1` until the above are resolved and external validation signs off on a stable `v1`.

## What “stable v1” would require

- Clear text-weight provenance (or permanently drop text from v1 surface)
- Approved LGPL FFmpeg sidecar sources per supported platform (or explicit “system-only” policy)
- Schema ID promotion from `/v1alpha1` → `/v1` with a migration note
- Tagged release after CI green on those policies
