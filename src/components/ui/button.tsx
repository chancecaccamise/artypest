import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/*
  Buttons are rectangles with a 3px radius and a hairline border. No shadow,
  no gradient. The only motion is the 120ms color transition.
*/
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[3px] border font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'border-moss bg-moss text-on-accent hover:bg-moss-hover hover:border-moss-hover',
        secondary:
          'border-rule bg-paper-raised text-ink hover:bg-paper-sunken hover:border-rule-strong',
        ghost: 'border-transparent bg-transparent text-ink-muted hover:bg-paper-sunken',
        destructive:
          'border-oxblood bg-transparent text-oxblood hover:bg-oxblood hover:text-on-accent',
        link: 'border-transparent bg-transparent text-survey underline-offset-2 hover:underline',
      },
      size: {
        sm: 'h-7 px-2 text-xs [&_svg]:size-3.5',
        md: 'h-9 px-3 text-sm [&_svg]:size-4',
        lg: 'h-11 px-5 text-base [&_svg]:size-4',
        icon: 'size-9 [&_svg]:size-4',
        'icon-sm': 'size-7 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
})

export { buttonVariants }
