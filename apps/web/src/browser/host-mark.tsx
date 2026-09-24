const LETTER: Record<string, string> = {
  'claude-code': 'C',
  'codex': 'X',
  'grok': 'G',
}

export function hostLetter(id: string): string {
  return LETTER[id] ?? id.slice(0, 1).toUpperCase()
}

/** The 22 px host chip. Colors are `--host-<id>` in styles.css. */
export function HostMark(props: { id: string }) {
  return (
    <span
      class="data flex size-[22px] shrink-0 items-center justify-center rounded-md border border-input text-[11px] font-medium"
      style={{ color: `var(--host-${props.id}, var(--muted-foreground))` }}
      aria-hidden="true"
    >
      {hostLetter(props.id)}
    </span>
  )
}
