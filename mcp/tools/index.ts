import type { PiartMcpContext } from '../context'
import { registerProjectTools } from './projectTools'
import { registerProviderTools } from './providerTools'
import { registerAssetTools } from './assetTools'
import { registerPixelTools } from './pixelTools'
import { registerAnimationTools } from './animationTools'
import { registerPromptTools } from './promptTools'
import { registerWorldTools } from './worldTools'
import { registerQueueTools } from './queueTools'
import { registerExportTools } from './exportTools'
import { registerAutomationTools } from './automationTools'

export type ToolModuleRegistrar = (ctx: PiartMcpContext) => void

/**
 * Central list of MCP tool modules.
 * Add new domain tool modules here to extend AI Pixel Studio MCP cleanly.
 */
export const TOOL_MODULES: ToolModuleRegistrar[] = [
  registerProjectTools,
  registerProviderTools,
  registerAssetTools,
  registerPixelTools,
  registerAnimationTools,
  registerPromptTools,
  registerWorldTools,
  registerQueueTools,
  registerExportTools,
  registerAutomationTools
]

export function registerAllTools(ctx: PiartMcpContext): void {
  for (const register of TOOL_MODULES) {
    register(ctx)
  }
}
