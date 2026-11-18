import { Icon, type IconProps } from './icon.tsx'

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" />
    </Icon>
  )
}
