const LETTER: Record<string, string> = {
  'claude-code': 'C',
  codex: 'X',
  dsh: 'D',
  grok: 'G',
  opencode: 'O',
  pi: 'P',
}

function agentLetter(id: string): string {
  return LETTER[id] ?? id.slice(0, 1).toUpperCase()
}

/** The 22 px agent chip. Colors are `--agent-<id>` in styles.css. */
export function AgentMark(props: { id: string }) {
  return (
    <span
      class="font-mono flex size-[22px] shrink-0 items-center justify-center rounded-md border border-input text-[11px] font-medium"
      style={{ color: `var(--agent-${props.id}, var(--muted-foreground))` }}
      aria-hidden="true"
    >
      {agentLetter(props.id)}
    </span>
  )
}
