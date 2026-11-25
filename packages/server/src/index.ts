export { BASE_PATH, type EstelaApp } from './composition/definition.ts'
export {
  createEstelaServer,
  type EstelaServer,
  type EstelaServerOptions,
  type OpenedSession,
} from './composition/estela-server.ts'
export type { AgentProgress, SessionCatalog, UnreadableRoot } from './catalog/session-catalog.ts'
export { checkReportOutDir, reportOf, ReportOutDirError } from './report/report.ts'
export { loadSession, type ShellPlatform } from './sessions/load-session.ts'
export { errorMessage } from './sessions/read-failure.ts'
export { serverRedaction } from './sessions/redaction.ts'
export { oneLine, parseSessionTarget, sessionTargetLabel } from './sessions/session-target.ts'
