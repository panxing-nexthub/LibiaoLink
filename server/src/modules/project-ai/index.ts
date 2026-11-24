/** project-ai 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export { ProjectAiModule } from "./project-ai.module.js";
export { ProjectAiContextService } from "./project-ai-context.service.js";
export { ProjectAiAgreementService } from "./project-ai-agreement.service.js";
export { ProjectAiEquipmentService } from "./project-ai-equipment.service.js";
export { ProjectAiSummaryService, PROJECT_AI_PROMPT_VERSION, hashProjectAiContext } from "./project-ai-summary.service.js";
export { ProjectAiModelClient } from "./project-ai.model.js";
export { ProjectAiContextController } from "./project-ai.controller.js";
