export function StatusPill(props: { children: string }) {
  return (
    <span class="rounded-full border border-input px-[9px] py-px text-[12px] whitespace-nowrap text-muted-foreground">
      {props.children}
    </span>
  )
}
