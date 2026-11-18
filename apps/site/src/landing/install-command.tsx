import { useEffect, useRef, useState } from 'react'
import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { CheckIcon, CopyIcon } from '@/components/icons/index.ts'
import { Button } from '@/components/ui/button.tsx'
import { INSTALL_COMMAND } from '@/content/links.ts'

export function InstallCommand({ t }: { t: Dictionary }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => clearTimeout(timerRef.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND)
    } catch {
      // No clipboard permission (an insecure origin or a denied prompt): the command stays selectable.
      return
    }
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="flex h-12 w-full max-w-[420px] items-center rounded-lg border border-input bg-muted pr-1.5 pl-4 font-mono text-[14px] shadow-[0_1px_0_0_color-mix(in_srgb,var(--foreground)_4%,transparent)_inset]">
      <span className="mr-3 text-subtle select-none" aria-hidden="true">
        $
      </span>
      <code className="flex-1 truncate select-all">{INSTALL_COMMAND}</code>
      <Button variant="ghost" size="icon" className="size-9" onClick={copy} aria-label={t.hero.copy}>
        {copied ? <CheckIcon className="text-kind-user" /> : <CopyIcon />}
      </Button>
      <span className="sr-only" role="status">
        {copied ? t.hero.copied : ''}
      </span>
    </div>
  )
}
