# @gvf/vision

Local vision for GVF:

- **Objects (v1):** YOLOX-Nano via optional `onnxruntime-node`. All 80 COCO classes
  with group aliases `people`, `animals`, `vehicles`, `products` (curated subset).
- **Text (v1 interfaces):** presence, regions, coverage — **no OCR**. Weight download
  is **blocked** until provenance is verified (`model-manifest.json`).

Weights are never in git or npm. See `model-manifest.json` and `docs/PROVENANCE.md`.
