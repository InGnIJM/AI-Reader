/**
 * IPC Handler Registration
 *
 * 集中注册所有 IPC 处理器。
 * 在 app.whenReady() 之后、createWindow() 之前调用。
 */

import { registerSystemHandlers } from './system';
import { registerWorkspaceHandlers } from './workspace';
import { registerDocumentHandlers } from './documents';
import { registerJobHandlers } from './jobs';
import { registerAnnotationHandlers } from './annotations';
import { registerCodeAnalysisHandlers } from './code-analysis';
import { registerSettingsHandlers } from './settings';
import type { DatabaseClient } from '../db/client';
import { WorkspaceService } from '../services/workspace';
import { DocumentImportService } from '../services/document-import';
import { GenerationJobService } from '../services/generation-job';
import { AnnotationService } from '../services/annotation';
import { SettingsService } from '../services/settings-service';
import {
  AnalysisAnnotationService,
  AnalysisExportService,
  AnalysisReplyEngine,
  CodeAnalysisService,
} from '../services/code-analysis';
import { loadLLMConfig } from '../llm/config';
import { OpenAICompatibleProvider } from '../llm/openai-compatible';
import { createLogger } from '@ai-reader/shared';

const log = createLogger('ipc');

/**
 * 注册所有 IPC 处理器。
 *
 * @param db 数据库客户端实例
 */
export function registerAllHandlers(db: DatabaseClient): void {
  log.info('Registering IPC handlers...');

  // 创建服务实例
  const workspaceService = new WorkspaceService(db);
  const documentImportService = new DocumentImportService(db);
  const jobService = new GenerationJobService(db);
  const annotationService = new AnnotationService(db);
  const settingsService = new SettingsService(db);
  const llmConfig = loadLLMConfig();
  const llmProvider = new OpenAICompatibleProvider({
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    defaultModel: llmConfig.model,
  });
  const codeAnalysisService = new CodeAnalysisService({
    db,
    llm: llmProvider,
    settings: settingsService,
  });
  const analysisAnnotationService = new AnalysisAnnotationService(db);
  const analysisReplyEngine = new AnalysisReplyEngine({
    db,
    llm: llmProvider,
    annotationService: analysisAnnotationService,
    settings: settingsService,
  });
  const analysisExportService = new AnalysisExportService(db);

  // 注册各模块处理器
  registerSystemHandlers();
  registerSettingsHandlers(settingsService);
  registerWorkspaceHandlers(workspaceService);
  registerDocumentHandlers(documentImportService);
  registerJobHandlers(jobService);
  registerAnnotationHandlers(annotationService);
  registerCodeAnalysisHandlers({
    codeAnalysisService,
    analysisAnnotationService,
    analysisReplyEngine,
    analysisExportService,
  });

  log.info('All IPC handlers registered');
}
