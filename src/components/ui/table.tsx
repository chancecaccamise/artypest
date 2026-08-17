import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/*
  Dense table. 40px rows, zebra striping in --paper-sunken at low opacity,
  hairline rules. Board members scan 300 lots at a time, so nothing here is
  allowed to add vertical padding for looks.

  The wrapper scrolls horizontally on its own so the page body never does.
*/
export function TableWrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full border-collapse text-left text-[0.8125rem]', className)}
      {...props}
    />
  )
}

export function Thead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-paper-sunken', className)} {...props} />
}

export function Tbody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-rule h-10 border-b transition-colors duration-[120ms]',
        'odd:bg-paper-sunken/30',
        className
      )}
      {...props}
    />
  )
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-rule text-ink-muted h-9 border-b px-3 text-xs font-semibold tracking-[0.06em] uppercase whitespace-nowrap',
        className
      )}
      {...props}
    />
  )
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('text-ink px-3 align-middle', className)} {...props} />
}
