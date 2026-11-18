import { Icon, type IconProps } from './icon.tsx'

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5 V6.5 A2 2 0 0 0 13.5 4.5 H6.5 A2 2 0 0 0 4.5 6.5 V13.5 A2 2 0 0 0 6.5 15.5 H8.5" />
    </Icon>
  )
}
