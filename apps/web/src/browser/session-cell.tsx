export function SessionCell(props: { class: string; text: string }) {
  return (
    <span class={`font-mono ${props.class} shrink-0 text-right text-[12px] text-muted-foreground`}>{props.text}</span>
  )
}
