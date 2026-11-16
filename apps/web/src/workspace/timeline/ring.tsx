/** The highlight ring drawn around one timeline bar: dashed for the compare pick, solid for the selection. */
export function Ring(props: {
  x: number
  y: number
  width: number
  stroke: string
  dashed?: boolean
  testId?: string
}) {
  return (
    <rect
      x={props.x}
      y={props.y}
      width={props.width}
      height="13"
      rx="3"
      fill="none"
      stroke={props.stroke}
      stroke-width="1.25"
      stroke-dasharray={props.dashed ? '2 2' : undefined}
      data-testid={props.testId}
    />
  )
}
