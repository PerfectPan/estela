export const REPORT_ISSUE_URL = 'https://github.com/PerfectPan/estela/issues/new/choose'

export function isUnknownFormatGeneration(reason: string): boolean {
  return reason.includes('unknown format generation')
}
