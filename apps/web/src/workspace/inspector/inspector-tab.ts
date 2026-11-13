import type { MessageKey } from '@/i18n/locale.ts'

export type InspectorTab = 'input' | 'output' | 'model' | 'compare' | 'raw'

export const INSPECTOR_TABS: { id: InspectorTab; label: MessageKey }[] = [
  { id: 'input', label: 'inspector.input' },
  { id: 'output', label: 'inspector.output' },
  { id: 'model', label: 'inspector.model' },
  { id: 'compare', label: 'inspector.compare' },
  { id: 'raw', label: 'inspector.raw' },
]
