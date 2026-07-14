/**
 * Public contract v1alpha1 / unstable — do not treat as frozen v1 until validation.
 * Schema IDs use the `/v1alpha1` suffix until a stable v1 release is declared.
 */

import { z } from 'zod/v4'

export const SCHEMA_MANIFEST = 'gvf.manifest/v1alpha1' as const
export const SCHEMA_FRAME = 'gvf.frame/v1alpha1' as const
export const SCHEMA_SELECTIONS = 'gvf.selections/v1alpha1' as const
export const SCHEMA_PROBE = 'gvf.probe/v1alpha1' as const
export const SCHEMA_RESULT = 'gvf.result/v1alpha1' as const

export const SamplingStrategySchema = z.enum(['every', 'fps', 'count', 'at', 'all'])

export const SamplingPlanSchema = z.object({
  strategy: SamplingStrategySchema,
  requestedIntervalSec: z.number().positive().optional(),
  effectiveIntervalSec: z.number().positive().optional(),
  requestedCount: z.number().int().positive().optional(),
  requestedFps: z.number().positive().optional(),
  timestampsSec: z.array(z.number().nonnegative()).optional(),
  fromSec: z.number().nonnegative().optional(),
  toSec: z.number().positive().optional(),
  count: z.number().int().nonnegative(),
  capped: z.boolean(),
  /** Null means uncapped direct extraction; candidate workspaces always record a budget. */
  budget: z.number().int().positive().nullable(),
  /** Never claim equal analysis density when capped. */
  equalDensity: z.boolean(),
  timestampBasis: z.enum(['planned-interval', 'source-pts', 'estimated-fps']).optional()
})

export type SamplingPlan = z.infer<typeof SamplingPlanSchema>

export const ProbeResultSchema = z.object({
  schema: z.literal(SCHEMA_PROBE).default(SCHEMA_PROBE),
  path: z.string(),
  durationSec: z.number().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  codedWidth: z.number().int().nonnegative().optional(),
  codedHeight: z.number().int().nonnegative().optional(),
  rotation: z.number().optional(),
  fps: z.number().nonnegative(),
  codec: z.string(),
  container: z.string(),
  hasAudio: z.boolean(),
  sizeBytes: z.number().nonnegative()
})

export type ProbeResult = z.infer<typeof ProbeResultSchema>

export const ProviderProvenanceSchema = z.object({
  providerId: z.string(),
  modelId: z.string().optional(),
  version: z.string().optional(),
  provenanceId: z.string().optional(),
  /** True only after all 80 COCO classes were evaluated for every frame. */
  detectionsComplete: z.boolean().optional(),
  detectionMinConfidence: z.number().finite().min(0.01).max(1).optional(),
  /** True only after a verified text provider populated every frame. */
  textComplete: z.boolean().optional()
})

export const WorkspaceManifestSchema = z.object({
  schema: z.literal(SCHEMA_MANIFEST),
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.object({
    path: z.string(),
    probe: ProbeResultSchema.optional()
  }),
  sampling: SamplingPlanSchema.optional(),
  providers: z
    .object({
      ffmpeg: ProviderProvenanceSchema.optional(),
      vision: ProviderProvenanceSchema.optional()
    })
    .optional(),
  artifacts: z.object({
    framesJsonl: z.string().default('frames.jsonl'),
    selections: z.string().default('selections.json'),
    framesDir: z.string().default('frames')
  }),
  candidateFormat: z
    .enum(['image/jpeg', 'image/png', 'image/webp'])
    .default('image/jpeg'),
  candidateMaxWidth: z.number().int().positive().default(640)
})

export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>

export const FrameMetricsSchema = z.object({
  sceneIndex: z.number().int().nonnegative().optional(),
  sceneDifference: z.number().finite().min(0).max(1).optional(),
  sharpness: z.number().finite().min(0).max(1).optional(),
  exposure: z.number().finite().min(0).max(1).optional(),
  uniqueness: z.number().finite().min(0).max(1).optional(),
  scenePosition: z.number().finite().min(0).max(1).optional(),
  composite: z.number().finite().min(0).max(1).optional(),
  blurVariance: z.number().finite().nonnegative().optional(),
  exposureMean: z.number().finite().min(0).max(1).optional(),
  exposureClippedRatio: z.number().finite().min(0).max(1).optional(),
  duplicateOfId: z.string().nullable().optional(),
  hash: z.array(z.number().int()).optional()
})

export const DetectionBoxSchema = z.object({
  classId: z.number().int(),
  className: z.string(),
  group: z.enum(['people', 'animals', 'vehicles', 'products']).optional(),
  confidence: z.number().finite().min(0).max(1),
  box: z.object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().min(0).max(1),
    height: z.number().finite().min(0).max(1)
  })
})

export const TextInfoSchema = z.object({
  hasText: z.boolean(),
  coverage: z.number().finite().min(0).max(1),
  regionCount: z.number().int().nonnegative(),
  regions: z
    .array(
      z.object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
        width: z.number().finite().min(0).max(1),
        height: z.number().finite().min(0).max(1),
        pixelCount: z.number().int().nonnegative()
      })
    )
    .optional()
})

export const FrameRecordSchema = z.object({
  schema: z.literal(SCHEMA_FRAME).default(SCHEMA_FRAME),
  id: z.string(),
  index: z.number().int().nonnegative(),
  timeMs: z.number().nonnegative(),
  timeSec: z.number().nonnegative(),
  path: z.string(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  metrics: FrameMetricsSchema.optional(),
  detections: z.array(DetectionBoxSchema).optional(),
  text: TextInfoSchema.optional()
})

export type FrameRecord = z.infer<typeof FrameRecordSchema>

export const SelectionReasonSchema = z.object({
  code: z.string(),
  message: z.string()
})

export const SelectionEntrySchema = z.object({
  frameId: z.string(),
  timeMs: z.number().nonnegative(),
  timeSec: z.number().nonnegative(),
  reasons: z.array(SelectionReasonSchema)
})

export const SelectionsFileSchema = z.object({
  schema: z.literal(SCHEMA_SELECTIONS),
  createdAt: z.string(),
  sourcePath: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  ranking: z.record(z.string(), z.unknown()).optional(),
  selections: z.array(SelectionEntrySchema)
})

export type SelectionsFile = z.infer<typeof SelectionsFileSchema>

export const DEFAULT_CANDIDATE_INTERVAL_SEC = 0.5
export const DEFAULT_CANDIDATE_BUDGET = 1200
