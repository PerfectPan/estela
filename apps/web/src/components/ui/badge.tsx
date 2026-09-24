import type { ComponentProps } from 'solid-js'
import { splitProps } from 'solid-js'
import type { VariantProps } from 'cva'
import { cva } from '@/lib/cva'

export const badgeVariants = cva({
  base: 'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0',
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>

export function Badge(props: BadgeProps) {
  const [, rest] = splitProps(props, ['class', 'variant'])
  return (
    <span
      data-slot="badge"
      class={badgeVariants({ variant: props.variant, class: props.class })}
      {...rest}
    />
  )
}
