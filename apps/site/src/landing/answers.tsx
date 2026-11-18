import type { ReactNode } from 'react'
import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { cx } from '@/lib/cva.ts'
import { sessionShape } from '@/scene/session-shape.ts'
import { CompactionFigure } from './figures/compaction-figure.tsx'
import { LanesFigure } from './figures/lanes-figure.tsx'
import { ModelSawFigure } from './figures/model-saw-figure.tsx'
import { TimelineFigure } from './figures/timeline-figure.tsx'
import { SectionHeading } from './section-heading.tsx'

export function Answers({ t, sectionId, headingId }: { t: Dictionary; sectionId: string; headingId: string }) {
  const shape = sessionShape()
  const figures: Record<string, ReactNode> = {
    saw: <ModelSawFigure t={t} />,
    compaction: <CompactionFigure shape={shape} />,
    tokens: <TimelineFigure shape={shape} t={t} />,
    lanes: <LanesFigure shape={shape} t={t} />,
  }
  return (
    <section aria-labelledby={headingId} id={sectionId} className="mx-auto max-w-[1240px] px-5 py-24 md:px-8 md:py-32">
      <SectionHeading id={headingId} eyebrow={t.answers.eyebrow} title={t.answers.title} />
      <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {t.answers.items.map((item, index) => (
          <article
            key={item.id}
            className={cx(
              'group flex flex-col overflow-hidden rounded-xl border border-border bg-secondary transition-colors hover:border-input',
              index === 0 && 'md:col-span-2 md:flex-row lg:col-span-3',
            )}
          >
            <div
              className={cx(
                'flex items-center border-b border-border bg-background/50 p-6 md:p-8',
                index === 0 && 'md:w-[46%] md:border-r md:border-b-0 lg:w-[40%]',
              )}
            >
              <div className="w-full">{figures[item.id]}</div>
            </div>
            <div className={cx('p-6 md:p-8', index === 0 && 'md:flex md:flex-1 md:flex-col md:justify-center')}>
              <h3
                className={cx(
                  'font-semibold tracking-[-0.015em]',
                  index === 0 ? 'text-[24px] md:text-[28px]' : 'text-[19px]',
                )}
              >
                {item.question}
              </h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">{item.answer}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
