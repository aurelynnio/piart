export interface PromptTemplateSpec {
  templateId: string
  templateVersion: string
  stepKind: string
  systemInstruction: string
}

export const PLANNER_SYSTEM_PROMPT = `Bạn là bộ lập kế hoạch thao tác cho AI Pixel Studio. Hãy đọc kỹ yêu cầu bằng tiếng Việt hoặc tiếng Anh cùng ngữ cảnh dự án được truyền vào. Chỉ chọn các thao tác nằm trong danh mục allowedOperations đã cung cấp. Phân loại chính xác bước nào là chỉnh sửa dữ liệu cục bộ (deterministic — ví dụ đổi tốc độ clip, đổi FPS, đổi tên, di chuyển vật thể trên map) và bước nào cần gọi AI (ai_image hoặc ai_plan). Điền đúng các thông số người dùng nêu rõ; nếu phát hiện mâu thuẫn với thông số form đã đánh dấu Đã chọn, bắt buộc báo vào trường conflicts thay vì tự ý chọn. Với mọi thao tác sửa, chỉ nhắm mục tiêu bằng ID hợp lệ trong ngữ cảnh; nếu tên nhắc tới khớp nhiều đối tượng, trả về danh sách disambiguation để người dùng chọn. Biểu diễn thứ tự thực hiện bằng dependsOn không tạo chu trình. Gán chính xác cấp phạm vi thay đổi (frame, clip, sprite, mask_region, map_placement). Chỉ trả về JSON hợp lệ khớp đúng schema được yêu cầu.`

export const PROMPT_TEMPLATES: Record<string, PromptTemplateSpec> = {
  planner_v1: {
    templateId: 'planner_v1',
    templateVersion: '1.0.0',
    stepKind: 'plan',
    systemInstruction: PLANNER_SYSTEM_PROMPT
  },
  sprite_v1: {
    templateId: 'sprite_v1',
    templateVersion: '1.0.0',
    stepKind: 'generate_sprite',
    systemInstruction:
      'Generate a crisp 2D pixel art sprite with clean silhouette, no anti-aliased blur, transparent background, consistent perspective and exact palette harmony.'
  },
  animation_v1: {
    templateId: 'animation_v1',
    templateVersion: '1.0.0',
    stepKind: 'generate_animation',
    systemInstruction:
      'Generate sequential 2D pixel art animation frames preserving the approved base sprite identity, proportions, palette, and foot anchor baseline across all frames.'
  },
  inpaint_v1: {
    templateId: 'inpaint_v1',
    templateVersion: '1.0.0',
    stepKind: 'inpaint_region',
    systemInstruction:
      'Edit strictly the masked region of the pixel art sprite according to the user request while keeping lighting, palette, pixel density, and all unmasked pixels completely unchanged.'
  },
  tileset_ui_vfx_v1: {
    templateId: 'tileset_ui_vfx_v1',
    templateVersion: '1.0.0',
    stepKind: 'generate_tileset_ui_vfx',
    systemInstruction:
      'Generate crisp pixel-art tileset, UI component, or transparent VFX frames aligned to pixel grid with clean borders and consistent palette.'
  },
  map_layout_v1: {
    templateId: 'map_layout_v1',
    templateVersion: '1.0.0',
    stepKind: 'generate_map_layout',
    systemInstruction:
      'Produce a valid structured 2D tilemap layout JSON using only the provided tileIds and furniture assetIds, respecting footprints, walkable aisles, walls, door placement, and spawn points.'
  },
  storyboard_v1: {
    templateId: 'storyboard_v1',
    templateVersion: '1.0.0',
    stepKind: 'generate_storyboard',
    systemInstruction:
      'Produce a structured cutscene storyboard JSON referencing valid sceneIds, npcAssetIds, dialogueIds, shot durations in ms, and transition cues.'
  },
  narrative_v1: {
    templateId: 'narrative_v1',
    templateVersion: '1.0.0',
    stepKind: 'generate_dialogue_quest',
    systemInstruction:
      'Produce valid structured JSON for branching DialogueGraph, Quest definitions, or typed DataTable using only existing NPC, item, and StateFlag keys with reachable nodes and valid typed conditions.'
  }
}

export function buildSeparatedPromptPayload(params: {
  templateId: keyof typeof PROMPT_TEMPLATES
  structuredContext: Record<string, unknown>
  userPrompt: string
  referenceNotes?: string[]
}) {
  const tpl = PROMPT_TEMPLATES[params.templateId] ?? PROMPT_TEMPLATES.planner_v1
  return {
    templateId: tpl.templateId,
    templateVersion: tpl.templateVersion,
    system: tpl.systemInstruction,
    projectContext: params.structuredContext,
    userPrompt: params.userPrompt,
    referenceNotes: params.referenceNotes ?? []
  }
}
