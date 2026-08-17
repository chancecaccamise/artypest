import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** `md` for forms, `lg` for anything with a table inside. */
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' } as const

/*
  Modal dialog. Focus moves into the panel on open and returns to the trigger
  on close, Escape closes, and focus is trapped in between. This is the one
  place in the app that gets a shadow.
*/
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    panel?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    if (!panel?.contains(document.activeElement)) panel?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = overflow
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="bg-ink/40 absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
        data-testid="dialog-overlay"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? 'dialog-description' : undefined}
        tabIndex={-1}
        className={cn(
          'panel panel-enter relative flex max-h-[92vh] w-full flex-col focus-visible:outline-none',
          'rounded-b-none sm:rounded-b-[6px]',
          SIZES[size]
        )}
        style={{ boxShadow: '0 8px 32px -8px color-mix(in srgb, var(--ink) 30%, transparent)' }}
      >
        <div className="border-rule flex items-start justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 id="dialog-title" className="font-display text-ink text-base font-bold">
              {title}
            </h2>
            {description ? (
              <p id="dialog-description" className="text-ink-muted mt-0.5 text-13">
                {description}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <div className="border-rule flex items-center justify-end gap-2 border-t px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
