# @gvf/core

Command-neutral GVF handlers: probe, extract, analyze, detect, select, export, run.

Workspace contract `gvf.manifest/v1alpha1`:

- `manifest.json` — source, probe, sampling, providers, artifact refs
- `frames.jsonl` — one frame record per line
- `selections.json` — explainable picks (no implicit export)
- `frames/` — candidate assets

Two-phase design: bounded low-res candidates for analysis, then HQ re-extract of selected timestamps from source.

Handlers retain arrays for programmatic composition. Direct extracts also write
`gvf.extract-manifest/v1alpha1` plus `frames.jsonl`; CLI/MCP expose bounded summaries.
Smart all-frame sampling uses source PTS and refuses ambiguous candidate mappings.
