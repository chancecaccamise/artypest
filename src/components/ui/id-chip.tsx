import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface IdChipProps {
  /** Short caps prefix inside the chip, for example "PIN" or "LOT". */
  prefix?: string
  children: ReactNode
  className?: string
  title?: string
}

/*
  The signature element. Machine identifiers always render this way: IBM Plex
  Mono, 12px, muted, hairline border, 3px radius. Codes belong in tabular
  figures, and this is the motif that carries from the tables into the
  Connection Map.
*/
export function IdChip({ prefix, children, className, title }: IdChipProps) {
  return (
    <span className={cn('id-chip', className)} title={title}>
      {prefix ? (
        <span className="text-ink-faint text-[0.625rem] tracking-[0.08em] uppercase">{prefix}</span>
      ) : null}
      {children}
    </span>
  )
}

/** Chip variant that is a link, used for the outbound SAGIS viewer. */
export function IdChipLink({
  href,
  prefix,
  children,
  className,
  title,
}: IdChipProps & { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={cn(
        'id-chip hover:border-survey hover:text-survey transition-colors duration-[120ms]',
        className
      )}
    >
      {prefix ? (
        <span className="text-ink-faint text-[0.625rem] tracking-[0.08em] uppercase">{prefix}</span>
      ) : null}
      {children}
    </a>
  )
}
