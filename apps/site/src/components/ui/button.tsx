import type { ComponentProps } from 'react'
import type { VariantProps } from 'cva'
import { cva } from '@/lib/cva.ts'

export const buttonVariants = cva({
  base: [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors shrink-0 outline-none cursor-pointer',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    'focus-visible:ring-ring focus-visible:ring-[3px]',
  ],
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/88',
      outline: 'border border-input bg-background/60 hover:bg-accent hover:text-accent-foreground',
      ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
    },
    size: {
      default: 'h-9 px-3.5 text-sm',
      lg: 'h-11 px-5 text-[15px]',
      icon: 'size-9',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} data-slot="button" className={buttonVariants({ variant, size, className })} {...props} />
}
