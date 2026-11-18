import { Icon, type IconProps } from './icon.tsx'

export function ExternalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4.5 H19.5 V10 M19.5 4.5 L11 13" />
      <path d="M17 14 V18 A1.5 1.5 0 0 1 15.5 19.5 H6 A1.5 1.5 0 0 1 4.5 18 V8.5 A1.5 1.5 0 0 1 6 7 H10" />
    </Icon>
  )
}
