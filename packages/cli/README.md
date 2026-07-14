# @gvf/cli

The `gvf` command-line surface for local, no-telemetry video frame intelligence.
Use `gvf run` for the recommended pipeline; primitives provide advanced control.

Requires Node.js 22+ and system FFmpeg. Object vision setup is guided with
`gvf setup vision`; text predicates remain blocked until verified text weights ship.
Pass `--models-dir <path>` to setup/doctor/detect/select/run, or set
`GVF_MODELS_DIR`; inspection and providers use the same resolved directory.

CLI JSON is intentionally bounded. Direct extraction and candidate workspaces expose
manifest/JSONL artifact paths for complete frame metadata. Export/run require an empty
destination unless `--overwrite`, which preserves unrelated files.
