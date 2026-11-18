import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { cx } from '@/lib/cva.ts'

/** A sketch of the inspector's Model saw tab: the context of one request by slot. Sample numbers. */
export function ModelSawFigure({ t }: { t: Dictionary }) {
  const f = t.answers.figure
  const rows = [
    { mark: 'hatched', label: f.system, value: f.unavailable, muted: true },
    { mark: 'bg-kind-tool', label: f.tools, value: '24' },
    { mark: 'bg-kind-request', label: f.messages, value: '61k' },
    { mark: 'border border-dashed border-subtle', label: f.removed, value: '148k', struck: true },
  ]
  return (
    <div className="font-mono text-[12px]" aria-hidden="true">
      <div className="mb-4 flex h-3 overflow-hidden rounded-[3px]">
        <div className="hatched w-[14%]" />
        <div className="w-[18%] bg-kind-tool" />
        <div className="flex-1 bg-kind-request" />
      </div>
      <ul className="space-y-2">
        {rows.map(row => (
          <li key={row.label} className="flex items-center gap-2.5">
            <span className={cx('size-2.5 shrink-0 rounded-[2px]', row.mark)} />
            <span className={cx('flex-1', row.struck ? 'text-muted-foreground line-through' : 'text-foreground')}>
              {row.label}
            </span>
            <span className={row.muted ? 'text-muted-foreground italic' : 'text-muted-foreground'}>{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
