import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { EntityType } from '@/lib/data/types'

const TYPE_VAR: Record<EntityType, string> = {
  person: 'var(--type-person)',
  property: 'var(--type-property)',
  business: 'var(--type-business)',
  association: 'var(--type-association)',
  asset: 'var(--type-asset)',
  record: 'var(--type-record)',
  document: 'var(--type-document)',
}

/** The CSS custom property holding a type's color. Shared with the Connection Map. */
export function entityTypeColor(type: EntityType): string {
  return TYPE_VAR[type]
}

export interface TypeBadgeProps {
  type: EntityType
  children: ReactNode
  className?: string
}

/** A type-colored badge: color-mix keeps the tint on-token in both themes. */
export function TypeBadge({ type, children, className }: TypeBadgeProps) {
  const color = entityTypeColor(type)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-xs font-semibold',
        className
      )}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} calc(var(--type-tint-opacity) * 100%), transparent)`,
      }}
    >
      {children}
    </span>
  )
}

export type StatusTone = 'neutral' | 'moss' | 'survey' | 'amber' | 'oxblood'

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-rule text-ink-muted',
  moss: 'border-moss/40 text-moss',
  survey: 'border-survey/40 text-survey',
  amber: 'border-amber/40 text-amber',
  oxblood: 'border-oxblood/40 text-oxblood',
}

export function StatusBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-xs font-semibold',
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
