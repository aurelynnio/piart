import { z } from 'zod'

export const SCHEMA_VERSION = 2
export const MANIFEST_SCHEMA_VERSION = 1
export const MIN_IMPORTER_VERSION = '1.0.0'
export const PINNED_UNITY_VERSION = '6000.6.7f1'

export const DirectionSchema = z.enum([
  'down',
  'left',
  'right',
  'up',
  'down_left',
  'down_right',
  'up_left',
  'up_right'
])
export type Direction = z.infer<typeof DirectionSchema>

export const PerspectiveSchema = z.enum(['top-down', '3/4', 'side-view'])
export type Perspective = z.infer<typeof PerspectiveSchema>

export const ContentTypeSchema = z.enum([
  'auto',
  'character',
  'furniture_item',
  'animation',
  'tileset',
  'map',
  'ui_vfx',
  'dialogue_quest',
  'content_pack'
])
export type ContentType = z.infer<typeof ContentTypeSchema>

export const AssetTypeSchema = z.enum([
  'character',
  'portrait',
  'outfit',
  'item',
  'furniture',
  'icon',
  'tileset',
  'map',
  'ui_element',
  'ui_screen',
  'vfx',
  'cutscene',
  'dialogue',
  'quest',
  'data_table'
])
export type AssetType = z.infer<typeof AssetTypeSchema>

export const RevisionStatusSchema = z.enum(['draft', 'approved', 'archived', 'rejected'])
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>

export const LoopModeSchema = z.enum(['loop', 'once', 'ping_pong'])
export type LoopMode = z.infer<typeof LoopModeSchema>

export const PointPxSchema = z.object({
  x: z.number().int(),
  y: z.number().int()
})
export type PointPx = z.infer<typeof PointPxSchema>

export const SizePxSchema = z.object({
  w: z.number().int().min(1).max(4096),
  h: z.number().int().min(1).max(4096)
})
export type SizePx = z.infer<typeof SizePxSchema>

export const RectPxSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1)
})
export type RectPx = z.infer<typeof RectPxSchema>

export const FootprintTilesSchema = z.object({
  w: z.number().int().min(1).max(64),
  h: z.number().int().min(1).max(64)
})
export type FootprintTiles = z.infer<typeof FootprintTilesSchema>

export const NineSliceBordersSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  right: z.number().int().min(0),
  bottom: z.number().int().min(0)
})
export type NineSliceBorders = z.infer<typeof NineSliceBordersSchema>

export const PaletteColorSchema = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/),
  name: z.string().default(''),
  locked: z.boolean().default(false)
})
export type PaletteColor = z.infer<typeof PaletteColorSchema>

export const PaletteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  colors: z.array(PaletteColorSchema).min(1),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Palette = z.infer<typeof PaletteSchema>

export const ReferenceImageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['style', 'proportion', 'palette', 'pose', 'general']).default('general'),
  blobHash: z.string().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  createdAt: z.string()
})
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>

export const StylePresetSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1).default(1),
  name: z.string().min(1),
  perspective: PerspectiveSchema.default('3/4'),
  outlineStyle: z.enum(['dark', 'colored', 'none']).default('dark'),
  shadingStyle: z.enum(['flat', 'cel', 'dithered']).default('cel'),
  enforcePalette: z.boolean().default(true),
  paletteId: z.string().nullable().default(null),
  defaultCanvasPx: SizePxSchema.default({ w: 32, h: 48 }),
  referenceImageIds: z.array(z.string()).default([]),
  notes: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type StylePreset = z.infer<typeof StylePresetSchema>

export const ProjectConfigSchema = z.object({
  projectId: z.string().min(1),
  schemaVersion: z.number().int().min(1).default(SCHEMA_VERSION),
  configVersion: z.number().int().min(1).default(1),
  name: z.string().min(1),
  locale: z.enum(['vi-VN', 'en-US']).default('vi-VN'),
  pixelsPerUnit: z.number().int().min(1).max(512).default(32),
  tileSizePx: z.number().int().min(8).max(256).default(32),
  defaultCanvasPx: SizePxSchema.default({ w: 32, h: 48 }),
  defaultPerspective: PerspectiveSchema.default('3/4'),
  uiResolutionPx: SizePxSchema.default({ w: 480, h: 270 }),
  activePaletteId: z.string().nullable().default(null),
  activePresetId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  blobHash: z.string().min(1),
  order: z.number().int().min(0)
})
export type Layer = z.infer<typeof LayerSchema>

export const AttachmentPointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['hand_hold', 'door_handle', 'sit_anchor', 'vfx_emit', 'wearable', 'interact', 'custom']).default('custom'),
  x: z.number().int(),
  y: z.number().int()
})
export type AttachmentPoint = z.infer<typeof AttachmentPointSchema>

export const AssetRevisionSchema = z.object({
  revisionId: z.string().min(1),
  assetId: z.string().min(1),
  parentRevisionId: z.string().nullable().default(null),
  baseRevisionId: z.string().nullable().default(null),
  status: RevisionStatusSchema.default('draft'),
  staleConflict: z.boolean().default(false),
  rawBlobHash: z.string().nullable().default(null),
  normalizedBlobHash: z.string().nullable().default(null),
  maskBlobHash: z.string().nullable().default(null),
  canvasPx: SizePxSchema.default({ w: 32, h: 32 }),
  pivotPx: PointPxSchema.default({ x: 16, y: 31 }),
  footprintTiles: FootprintTilesSchema.nullable().default(null),
  collisionBox: RectPxSchema.nullable().default(null),
  nineSlice: NineSliceBordersSchema.nullable().default(null),
  layers: z.array(LayerSchema).default([]),
  attachmentPoints: z.array(AttachmentPointSchema).default([]),
  variantGroupId: z.string().nullable().default(null),
  direction: DirectionSchema.nullable().default(null),
  stateName: z.string().nullable().default(null),
  settingsSnapshot: z.record(z.unknown()).default({}),
  dependencyIds: z.array(z.string()).default([]),
  operationSummary: z.string().default(''),
  createdAt: z.string()
})
export type AssetRevision = z.infer<typeof AssetRevisionSchema>

export const AssetSchema = z.object({
  assetId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  type: AssetTypeSchema,
  description: z.string().default(''),
  folderId: z.string().nullable().default(null),
  collectionIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  parentAssetId: z.string().nullable().default(null),
  approvedRevisionId: z.string().nullable().default(null),
  latestRevisionId: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  trashedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Asset = z.infer<typeof AssetSchema>

export const FolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().nullable().default(null),
  kind: z.enum(['folder', 'collection']).default('folder'),
  createdAt: z.string()
})
export type Folder = z.infer<typeof FolderSchema>

export const FrameQcWarningSchema = z.object({
  code: z.enum([
    'EMPTY_FRAME',
    'EDGE_CLIPPED',
    'SIZE_MISMATCH',
    'ANCHOR_DRIFT',
    'LOOP_SEAM_JUMP',
    'DUPLICATE_UNMARKED',
    'MISSING_BLOB'
  ]),
  message: z.string(),
  severity: z.enum(['warning', 'error']).default('warning'),
  metric: z.number().optional()
})
export type FrameQcWarning = z.infer<typeof FrameQcWarningSchema>

export const FrameEventSchema = z.object({
  eventId: z.string().min(1),
  name: z.string().min(1),
  frameId: z.string().min(1),
  timeMs: z.number().int().min(0),
  payload: z.record(z.unknown()).default({})
})
export type FrameEvent = z.infer<typeof FrameEventSchema>

export const ClipFrameSchema = z.object({
  frameId: z.string().min(1),
  slotIndex: z.number().int().min(0),
  revisionId: z.string().min(1),
  blobHash: z.string().min(1),
  sourceRect: RectPxSchema.nullable().default(null),
  durationMs: z.number().int().min(1),
  offsetPx: PointPxSchema.default({ x: 0, y: 0 }),
  isLocked: z.boolean().default(false),
  isIntentionalHold: z.boolean().default(false),
  qcWarnings: z.array(FrameQcWarningSchema).default([])
})
export type ClipFrame = z.infer<typeof ClipFrameSchema>

export const ClipSchema = z.object({
  clipId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  action: z.string().min(1),
  direction: DirectionSchema.default('down'),
  fps: z.number().min(1).max(60).default(8),
  loopMode: LoopModeSchema.default('loop'),
  playbackSpeed: z.number().positive().default(1),
  canvasPx: SizePxSchema.default({ w: 32, h: 48 }),
  anchorPx: PointPxSchema.default({ x: 16, y: 46 }),
  frames: z.array(ClipFrameSchema).default([]),
  events: z.array(FrameEventSchema).default([]),
  status: RevisionStatusSchema.default('draft'),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Clip = z.infer<typeof ClipSchema>

export const TileSchema = z.object({
  tileId: z.string().min(1),
  name: z.string().min(1),
  blobHash: z.string().min(1),
  terrainTag: z.string().default('ground'),
  walkable: z.boolean().default(true),
  collisionShape: z.enum(['none', 'full', 'top', 'bottom', 'left', 'right', 'custom']).default('none'),
  customCollisionRect: RectPxSchema.nullable().default(null),
  isOverlay: z.boolean().default(false)
})
export type Tile = z.infer<typeof TileSchema>

export const AutoTileRuleSchema = z.object({
  ruleId: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(['4-bit', '8-bit']).default('4-bit'),
  terrainTag: z.string().min(1),
  bitmask: z.number().int().min(0).max(255),
  tileId: z.string().min(1),
  priority: z.number().int().default(0)
})
export type AutoTileRule = z.infer<typeof AutoTileRuleSchema>

export const TileSetSchema = z.object({
  tilesetId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  tileSizePx: z.number().int().min(8).max(256).default(32),
  paddingPx: z.number().int().min(0).max(16).default(2),
  tiles: z.array(TileSchema).default([]),
  autoTileRules: z.array(AutoTileRuleSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type TileSet = z.infer<typeof TileSetSchema>

export const SceneLayerSchema = z.object({
  layerId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['ground', 'detail', 'object', 'overlay', 'collision', 'trigger']),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  order: z.number().int().min(0),
  cells: z.record(z.string(), z.string()).default({})
})
export type SceneLayer = z.infer<typeof SceneLayerSchema>

export const ScenePlacementSchema = z.object({
  placementId: z.string().min(1),
  assetId: z.string().min(1),
  revisionId: z.string().nullable().default(null),
  name: z.string().min(1),
  layerId: z.string().min(1),
  gridX: z.number().int(),
  gridY: z.number().int(),
  offsetPx: PointPxSchema.default({ x: 0, y: 0 }),
  footprint: FootprintTilesSchema.default({ w: 1, h: 1 }),
  facing: DirectionSchema.default('down'),
  ySortOffset: z.number().int().default(0),
  blocksMovement: z.boolean().default(true),
  linkedDialogueId: z.string().nullable().default(null),
  linkedQuestId: z.string().nullable().default(null)
})
export type ScenePlacement = z.infer<typeof ScenePlacementSchema>

export const SceneMarkerSchema = z.object({
  markerId: z.string().min(1),
  kind: z.enum(['spawn', 'door', 'trigger']),
  name: z.string().min(1),
  gridX: z.number().int(),
  gridY: z.number().int(),
  widthTiles: z.number().int().min(1).default(1),
  heightTiles: z.number().int().min(1).default(1),
  eventName: z.string().default(''),
  targetSceneId: z.string().nullable().default(null),
  linkedDialogueId: z.string().nullable().default(null),
  linkedQuestId: z.string().nullable().default(null)
})
export type SceneMarker = z.infer<typeof SceneMarkerSchema>

export const SceneSchema = z.object({
  sceneId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  cols: z.number().int().min(1).max(256),
  rows: z.number().int().min(1).max(256),
  tileSizePx: z.number().int().min(8).max(256).default(32),
  tilesetId: z.string().nullable().default(null),
  layers: z.array(SceneLayerSchema).default([]),
  placements: z.array(ScenePlacementSchema).default([]),
  collisionRects: z.array(RectPxSchema).default([]),
  markers: z.array(SceneMarkerSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Scene = z.infer<typeof SceneSchema>

export const UIElementLayoutSchema = z.object({
  elementId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['button', 'panel', 'dialogue_box', 'hud', 'inventory_slot', 'icon', 'label']),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  anchor: z.enum([
    'top-left',
    'top-center',
    'top-right',
    'middle-left',
    'center',
    'middle-right',
    'bottom-left',
    'bottom-center',
    'bottom-right'
  ]).default('top-left'),
  nineSlice: NineSliceBordersSchema.nullable().default(null),
  states: z.object({
    normalAssetId: z.string().nullable().default(null),
    pressedAssetId: z.string().nullable().default(null),
    disabledAssetId: z.string().nullable().default(null),
    hoverAssetId: z.string().nullable().default(null)
  }).default({}),
  text: z.string().default('')
})
export type UIElementLayout = z.infer<typeof UIElementLayoutSchema>

export const UIScreenSchema = z.object({
  screenId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  resolutionPx: SizePxSchema.default({ w: 480, h: 270 }),
  elements: z.array(UIElementLayoutSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type UIScreen = z.infer<typeof UIScreenSchema>

export const VFXConfigSchema = z.object({
  vfxId: z.string().min(1),
  assetId: z.string().min(1),
  clipId: z.string().min(1),
  name: z.string().min(1),
  emitterOffsetPx: PointPxSchema.default({ x: 0, y: 0 }),
  previewTargetType: z.enum(['none', 'asset', 'scene']).default('none'),
  previewTargetId: z.string().nullable().default(null),
  blendMode: z.enum(['normal', 'additive']).default('normal'),
  playbackSpeed: z.number().positive().default(1),
  loopMode: LoopModeSchema.default('loop'),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type VFXConfig = z.infer<typeof VFXConfigSchema>

export const CutsceneShotSchema = z.object({
  shotId: z.string().min(1),
  order: z.number().int().min(0),
  title: z.string().min(1),
  durationMs: z.number().int().min(100).default(2000),
  sceneId: z.string().nullable().default(null),
  dialogueId: z.string().nullable().default(null),
  speakerAssetId: z.string().nullable().default(null),
  referencedAssetIds: z.array(z.string()).default([]),
  dialogueText: z.string().default(''),
  cameraNotes: z.string().default(''),
  transitionCue: z.enum(['cut', 'fade_in', 'fade_out', 'pan', 'wait']).default('cut')
})
export type CutsceneShot = z.infer<typeof CutsceneShotSchema>

export const CutsceneSchema = z.object({
  cutsceneId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  shots: z.array(CutsceneShotSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Cutscene = z.infer<typeof CutsceneSchema>

export const StateFlagTypeSchema = z.enum(['bool', 'int', 'string'])
export type StateFlagType = z.infer<typeof StateFlagTypeSchema>

export const StateFlagSchema = z.object({
  flagId: z.string().min(1),
  key: z.string().min(1),
  type: StateFlagTypeSchema,
  defaultValue: z.union([z.boolean(), z.number().int(), z.string()]),
  description: z.string().default('')
})
export type StateFlag = z.infer<typeof StateFlagSchema>

export const ConditionExprSchema = z.object({
  kind: z.enum(['flag_eq', 'flag_gte', 'has_item', 'quest_status']),
  key: z.string().min(1),
  value: z.union([z.boolean(), z.number().int(), z.string()])
})
export type ConditionExpr = z.infer<typeof ConditionExprSchema>

export const ActionEffectSchema = z.object({
  kind: z.enum(['set_flag', 'give_item', 'take_item', 'start_quest', 'complete_quest']),
  key: z.string().min(1),
  value: z.union([z.boolean(), z.number().int(), z.string()])
})
export type ActionEffect = z.infer<typeof ActionEffectSchema>

export const DialogueNodeSchema = z.object({
  nodeId: z.string().min(1),
  kind: z.enum(['dialogue', 'choice', 'condition', 'action', 'end']),
  speakerAssetId: z.string().nullable().default(null),
  speakerName: z.string().default(''),
  text: z.string().default(''),
  condition: ConditionExprSchema.nullable().default(null),
  effects: z.array(ActionEffectSchema).default([]),
  position: PointPxSchema.default({ x: 0, y: 0 })
})
export type DialogueNode = z.infer<typeof DialogueNodeSchema>

export const DialogueEdgeSchema = z.object({
  edgeId: z.string().min(1),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  label: z.string().default(''),
  condition: ConditionExprSchema.nullable().default(null)
})
export type DialogueEdge = z.infer<typeof DialogueEdgeSchema>

export const DialogueGraphSchema = z.object({
  dialogueId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  npcAssetId: z.string().nullable().default(null),
  startNodeId: z.string().min(1),
  nodes: z.array(DialogueNodeSchema).min(1),
  edges: z.array(DialogueEdgeSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type DialogueGraph = z.infer<typeof DialogueGraphSchema>

export const QuestObjectiveSchema = z.object({
  objectiveId: z.string().min(1),
  description: z.string().min(1),
  condition: ConditionExprSchema
})
export type QuestObjective = z.infer<typeof QuestObjectiveSchema>

export const QuestRewardSchema = z.object({
  itemAssetId: z.string().nullable().default(null),
  itemKey: z.string().min(1),
  quantity: z.number().int().min(1).default(1)
})
export type QuestReward = z.infer<typeof QuestRewardSchema>

export const QuestSchema = z.object({
  questId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  giverNpcAssetId: z.string().nullable().default(null),
  prerequisiteQuestId: z.string().nullable().default(null),
  startConditions: z.array(ConditionExprSchema).default([]),
  objectives: z.array(QuestObjectiveSchema).default([]),
  rewards: z.array(QuestRewardSchema).default([]),
  completionFlagKey: z.string().default(''),
  completionEffects: z.array(ActionEffectSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Quest = z.infer<typeof QuestSchema>

export const DataTableColumnSchema = z.object({
  colId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['string', 'int', 'float', 'bool', 'enum', 'asset_ref']),
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  enumValues: z.array(z.string()).optional()
})
export type DataTableColumn = z.infer<typeof DataTableColumnSchema>

export const DataTableSchema = z.object({
  tableId: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  columns: z.array(DataTableColumnSchema).default([]),
  rows: z.array(z.record(z.string(), z.unknown())).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type DataTable = z.infer<typeof DataTableSchema>

export const ALLOWED_OPERATIONS = [
  'generate_sprite',
  'generate_directions',
  'generate_outfit',
  'generate_portrait',
  'generate_item',
  'generate_furniture',
  'generate_icon',
  'generate_asset_set',
  'generate_animation',
  'regenerate_frame',
  'inpaint_region',
  'generate_tileset',
  'generate_tile_transitions',
  'generate_map_layout',
  'generate_ui_element',
  'generate_ui_screen',
  'generate_ui_icon_set',
  'generate_vfx',
  'generate_storyboard',
  'generate_dialogue',
  'generate_quest',
  'generate_data_table',
  'update_clip_timing',
  'rename_asset',
  'move_map_placement',
  'apply_palette',
  'update_pivot'
] as const

export const OperationTypeSchema = z.enum(ALLOWED_OPERATIONS)
export type OperationType = z.infer<typeof OperationTypeSchema>

export const StepExecutionKindSchema = z.enum(['ai_image', 'ai_plan', 'deterministic'])
export type StepExecutionKind = z.infer<typeof StepExecutionKindSchema>

export const FieldSourceSchema = z.enum([
  'selected',
  'prompt',
  'asset',
  'preset',
  'default'
])
export type FieldSource = z.infer<typeof FieldSourceSchema>

export const ParameterConflictSchema = z.object({
  field: z.string().min(1),
  label: z.string().min(1),
  formValue: z.unknown(),
  promptValue: z.unknown(),
  resolvedChoice: z.enum(['form', 'prompt']).nullable().default(null)
})
export type ParameterConflict = z.infer<typeof ParameterConflictSchema>

export const DisambiguationCandidateSchema = z.object({
  assetId: z.string().min(1),
  name: z.string().min(1),
  type: AssetTypeSchema,
  folderName: z.string().default('Gốc'),
  revisionId: z.string().nullable().default(null)
})
export type DisambiguationCandidate = z.infer<typeof DisambiguationCandidateSchema>

export const DisambiguationRequestSchema = z.object({
  mentionText: z.string().min(1),
  candidates: z.array(DisambiguationCandidateSchema).min(2),
  selectedAssetId: z.string().nullable().default(null)
})
export type DisambiguationRequest = z.infer<typeof DisambiguationRequestSchema>

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  kind: StepExecutionKindSchema,
  operation: OperationTypeSchema,
  dependsOn: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  scope: z.enum(['asset', 'clip', 'frame', 'mask_region', 'map_placement', 'project']).default('asset'),
  targetAssetId: z.string().nullable().default(null),
  targetClipId: z.string().nullable().default(null),
  targetFrameIndex: z.number().int().min(0).nullable().default(null),
  sourceRevisionId: z.string().nullable().default(null),
  settings: z.record(z.unknown()).default({}),
  validation: z.record(z.unknown()).default({})
})
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

export const WorkflowPlanSchema = z.object({
  schemaVersion: z.number().int().min(1).default(1),
  planId: z.string().min(1),
  projectId: z.string().min(1),
  mode: z.enum(['create', 'edit']),
  promptText: z.string().default(''),
  resolvedConflicts: z.array(ParameterConflictSchema).default([]),
  disambiguations: z.array(DisambiguationRequestSchema).default([]),
  estimatedSummary: z.object({
    outputs: z.number().int().min(0).default(0),
    clips: z.number().int().min(0).default(0),
    frames: z.number().int().min(0).default(0),
    imageApiCalls: z.number().int().min(0).default(0),
    planApiCalls: z.number().int().min(0).default(0),
    localSteps: z.number().int().min(0).default(0)
  }).default({}),
  steps: z.array(WorkflowStepSchema).min(1)
})
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>

export const ExecutionSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  projectId: z.string().min(1),
  mode: z.enum(['create', 'edit']),
  contentType: ContentTypeSchema,
  promptText: z.string(),
  resolvedSettings: z.record(z.unknown()),
  fieldSources: z.record(z.string(), FieldSourceSchema),
  conflictsResolved: z.array(ParameterConflictSchema).default([]),
  targetAssetId: z.string().nullable().default(null),
  targetClipId: z.string().nullable().default(null),
  targetFrameIndex: z.number().int().min(0).nullable().default(null),
  baseRevisionId: z.string().nullable().default(null),
  maskBlobHash: z.string().nullable().default(null),
  referenceBlobHashes: z.array(z.string()).default([]),
  presetId: z.string().nullable().default(null),
  presetVersion: z.number().int().nullable().default(null),
  templateId: z.string().default('planner_v1'),
  templateVersion: z.string().default('1.0.0'),
  providerId: z.string().default('mock'),
  models: z.object({
    planner: z.string().default('mock-planner-v1'),
    imageGenerate: z.string().default('mock-image-v1'),
    imageEdit: z.string().default('mock-image-v1')
  }),
  createdAt: z.string()
})
export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshotSchema>

export const ProviderErrorCategorySchema = z.enum([
  'AUTH_INVALID',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'PAYLOAD_INVALID',
  'NETWORK_ERROR',
  'PROVIDER_SERVER_ERROR',
  'CONTENT_POLICY_REJECTED',
  'AMBIGUOUS_OUTCOME',
  'CANCELLED',
  'INTERNAL_ERROR'
])
export type ProviderErrorCategory = z.infer<typeof ProviderErrorCategorySchema>

export const JobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'ambiguous',
  'partial'
])
export type JobStatus = z.infer<typeof JobStatusSchema>

export const JobStepRecordSchema = z.object({
  stepId: z.string().min(1),
  jobId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  operation: OperationTypeSchema,
  kind: StepExecutionKindSchema,
  dependsOn: z.array(z.string()).default([]),
  status: JobStatusSchema.default('queued'),
  attemptCount: z.number().int().min(0).default(0),
  providerRequestId: z.string().nullable().default(null),
  errorCategory: ProviderErrorCategorySchema.nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  retryAfterMs: z.number().int().nullable().default(null),
  outputAssetIds: z.array(z.string()).default([]),
  outputRevisionIds: z.array(z.string()).default([]),
  outputClipIds: z.array(z.string()).default([]),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null)
})
export type JobStepRecord = z.infer<typeof JobStepRecordSchema>

export const JobRecordSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  status: JobStatusSchema,
  plan: WorkflowPlanSchema,
  snapshot: ExecutionSnapshotSchema,
  steps: z.array(JobStepRecordSchema),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type JobRecord = z.infer<typeof JobRecordSchema>

export const UsageLedgerEntrySchema = z.object({
  usageId: z.string().min(1),
  projectId: z.string().min(1),
  jobId: z.string().nullable().default(null),
  stepId: z.string().nullable().default(null),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  operation: z.string().min(1),
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  imageCount: z.number().int().min(0).default(0),
  isEstimated: z.boolean().default(false),
  createdAt: z.string()
})
export type UsageLedgerEntry = z.infer<typeof UsageLedgerEntrySchema>

export const PromptTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1),
  category: ContentTypeSchema,
  promptText: z.string(),
  options: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>

export const ExportManifestEntrySchema = z.object({
  stableId: z.string().min(1),
  revisionId: z.string().min(1),
  assetType: z.string().min(1),
  name: z.string().min(1),
  relativePath: z.string().min(1),
  metadataPath: z.string().nullable().default(null),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().min(0),
  dependencies: z.array(z.string()).default([])
})
export type ExportManifestEntry = z.infer<typeof ExportManifestEntrySchema>

export const ExportManifestSchema = z.object({
  manifestSchemaVersion: z.number().int().min(1).default(MANIFEST_SCHEMA_VERSION),
  minImporterVersion: z.string().default(MIN_IMPORTER_VERSION),
  pinnedUnityVersion: z.string().default(PINNED_UNITY_VERSION),
  exportRunId: z.string().min(1),
  exportedAt: z.string(),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  pixelsPerUnit: z.number().int().min(1),
  tileSizePx: z.number().int().min(8),
  conventions: z.object({
    imageOrigin: z.literal('top-left'),
    unitySpriteRectOrigin: z.literal('bottom-left'),
    unityPivotOrigin: z.literal('bottom-left-normalized'),
    tilemapMapping: z.literal('y_flipped_rows_minus_1_minus_row'),
    durationUnit: z.literal('milliseconds'),
    textureFilter: z.literal('Point'),
    textureCompression: z.literal('Uncompressed')
  }),
  scope: z.object({
    kind: z.enum(['asset', 'collection', 'scene', 'project']),
    rootIds: z.array(z.string())
  }),
  entries: z.array(ExportManifestEntrySchema)
})
export type ExportManifest = z.infer<typeof ExportManifestSchema>

export const ValidationIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  targetId: z.string().nullable().default(null),
  targetType: z.string().nullable().default(null),
  message: z.string().min(1)
})
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>

export const ModelCapabilitySchema = z.object({
  modelId: z.string().min(1),
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  supportsPlanning: z.boolean(),
  supportsImageGenerate: z.boolean(),
  supportsImageEditWithMask: z.boolean(),
  supportsReferenceImages: z.boolean(),
  supportsTransparentBackground: z.boolean(),
  maxInputBytes: z.number().int().positive(),
  isMock: z.boolean().default(false)
})
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>
