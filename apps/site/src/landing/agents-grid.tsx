import { Fragment } from 'react'
import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { AGENTS } from '@/content/agents.ts'
import { SectionHeading } from './section-heading.tsx'

export function AgentsGrid({ t, sectionId, headingId }: { t: Dictionary; sectionId: string; headingId: string }) {
  return (
    <section aria-labelledby={headingId} id={sectionId} className="border-y border-border bg-secondary">
      <div className="mx-auto max-w-[1240px] px-5 py-24 md:px-8 md:py-32">
        <SectionHeading id={headingId} eyebrow={t.agents.eyebrow} title={t.agents.title}>
          {t.agents.lead}
        </SectionHeading>
        <ul className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map(agent => (
            <li key={agent.id} className="flex min-h-[148px] flex-col bg-background p-5">
              <div className="flex items-center gap-2.5">
                <span
                  className="size-2.5 rounded-[3px]"
                  style={{ background: `var(--agent-${agent.id})` }}
                  aria-hidden="true"
                />
                <span className="font-semibold">{agent.name}</span>
              </div>
              <div className="mt-4 space-y-1">
                {agent.paths.map(path => (
                  // Long globs wrap after a slash, not inside a name.
                  <code key={path} className="block font-mono text-[12px] text-muted-foreground">
                    {path.split('/').map((part, index) => (
                      <Fragment key={`${index}-${part}`}>
                        {index > 0 ? '/' : null}
                        {index > 0 ? <wbr /> : null}
                        {part}
                      </Fragment>
                    ))}
                  </code>
                ))}
              </div>
              <code className="mt-auto pt-4 font-mono text-[11px] text-muted-foreground">${agent.home}</code>
            </li>
          ))}
          {/* Twelve agents fill whole rows at every width, so the note takes a row of its own. */}
          <li className="flex flex-col justify-end bg-background p-5 text-[13px] leading-relaxed text-muted-foreground sm:col-span-2 lg:col-span-4">
            {t.agents.grok}
          </li>
        </ul>
      </div>
    </section>
  )
}
