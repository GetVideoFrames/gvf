/**
 * All 80 native COCO class labels (0–79) used by YOLOX-Nano.
 * Group aliases are convenience filters — products is a curated subset.
 */

export const COCO_CLASS_NAMES: readonly string[] = [
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'airplane',
  'bus',
  'train',
  'truck',
  'boat',
  'traffic light',
  'fire hydrant',
  'stop sign',
  'parking meter',
  'bench',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep',
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  'backpack',
  'umbrella',
  'handbag',
  'tie',
  'suitcase',
  'frisbee',
  'skis',
  'snowboard',
  'sports ball',
  'kite',
  'baseball bat',
  'baseball glove',
  'skateboard',
  'surfboard',
  'tennis racket',
  'bottle',
  'wine glass',
  'cup',
  'fork',
  'knife',
  'spoon',
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'chair',
  'couch',
  'potted plant',
  'bed',
  'dining table',
  'toilet',
  'tv',
  'laptop',
  'mouse',
  'remote',
  'keyboard',
  'cell phone',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'refrigerator',
  'book',
  'clock',
  'vase',
  'scissors',
  'teddy bear',
  'hair drier',
  'toothbrush'
] as const

export type CocoClassName = (typeof COCO_CLASS_NAMES)[number]

export const COCO_CLASS_COUNT = 80

export function cocoClassName(classId: number): string {
  return COCO_CLASS_NAMES[classId] ?? `object_${classId}`
}

export function cocoClassId(name: string): number | undefined {
  const needle = name.trim().toLowerCase().replace(/_/g, ' ')
  const aliases: Record<string, string> = {
    phone: 'cell phone',
    cellphone: 'cell phone',
    'cell-phone': 'cell phone',
    tv: 'tv',
    aeroplane: 'airplane',
    motorbike: 'motorcycle',
    hotdog: 'hot dog',
    wineglass: 'wine glass',
    'hair dryer': 'hair drier',
    hairdryer: 'hair drier'
  }
  const resolved = aliases[needle] ?? needle
  const index = COCO_CLASS_NAMES.findIndex((label) => label === resolved)
  return index >= 0 ? index : undefined
}

/** Convenience group aliases (not model classes). */
export type VisionGroup = 'people' | 'animals' | 'vehicles' | 'products'

/**
 * Curated COCO subsets for group filters.
 * `products` is explicitly NOT universal product detection — bags, tableware,
 * food, consumer electronics, appliances, and small goods from COCO only.
 */
export const VISION_GROUP_CLASSES: Record<VisionGroup, readonly number[]> = {
  people: [0],
  vehicles: [1, 2, 3, 4, 5, 6, 7, 8],
  animals: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  products: [
    24, 25, 26, 27, 28, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    55, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76, 77, 78, 79
  ]
}

export function groupForClassId(classId: number): VisionGroup | undefined {
  for (const [group, ids] of Object.entries(VISION_GROUP_CLASSES) as Array<
    [VisionGroup, readonly number[]]
  >) {
    if (ids.includes(classId)) return group
  }
  return undefined
}

export function resolveObjectQuery(query: string): {
  kind: 'class' | 'group'
  classIds: number[]
  label: string
} {
  const raw = query.trim().toLowerCase().replace(/_/g, ' ')
  const groupAliases: Record<string, VisionGroup> = {
    people: 'people',
    person: 'people',
    animals: 'animals',
    animal: 'animals',
    vehicles: 'vehicles',
    vehicle: 'vehicles',
    products: 'products',
    product: 'products'
  }
  const group = groupAliases[raw]
  if (group) {
    return { kind: 'group', classIds: [...VISION_GROUP_CLASSES[group]], label: group }
  }
  const classId = cocoClassId(raw)
  if (classId == null) {
    throw new Error(
      `Unknown object class or group "${query}". Use a COCO class name, or group: people|animals|vehicles|products.`
    )
  }
  return { kind: 'class', classIds: [classId], label: cocoClassName(classId) }
}
