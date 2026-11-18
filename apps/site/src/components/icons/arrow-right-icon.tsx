import { Icon, type IconProps } from './icon.tsx'

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12 H19 M13 6 L19 12 L13 18" />
    </Icon>
  )
}
