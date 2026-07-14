# @gvf/ffmpeg

FFmpeg/ffprobe resolution, safe `spawn` helpers (`shell: false`), rotation-aware
probe/extract argument builders, and optional managed sidecar setup.

## Resolution order

1. Explicit `--ffmpeg` / `--ffprobe`
2. `GVF_FFMPEG_PATH` / `GVF_FFPROBE_PATH`
3. System `PATH`
4. Verified managed sidecar under `~/.gvf/runtime/ffmpeg/<platform-arch>/` (fallback)

GVF does **not** ship FFmpeg binaries in npm. `gvf setup ffmpeg` shows
source/license/checksum/destination from `sidecar-manifest.json`. Platform
downloads remain **blocked** until provenance is approved — until then setup
prints system package guidance. Managed installs are runtime management, not
MIT-licensed GVF source.
