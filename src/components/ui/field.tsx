import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

import { cn } from '@/lib/utils'

/*
  Every form control in the app is wrapped by <Field>. The wrapper owns the id,
  wires the <label> to the control, and associates the error message through
  aria-describedby so nothing has to remember to do it by hand.
*/

interface FieldContextValue {
  controlId: string
  describedBy: string | undefined
  invalid: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

function useFieldContext(): FieldContextValue {
  const context = useContext(FieldContext)
  if (!context) {
    // Controls are usable outside a Field, they just wire nothing up.
    return { controlId: '', describedBy: undefined, invalid: false }
  }
  return context
}

export interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: ReactNode
  /** Renders the label visually hidden while keeping it in the accessibility tree. */
  hideLabel?: boolean
}

export function Field({
  label,
  hint,
  error,
  required = false,
  className,
  children,
  hideLabel = false,
}: FieldProps) {
  const base = useId()
  const controlId = `${base}-control`
  const hintId = `${base}-hint`
  const errorId = `${base}-error`

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error) }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={controlId} className={cn('label-caps', hideLabel && 'sr-only')}>
          {label}
          {required ? <span className="text-oxblood"> *</span> : null}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className="text-ink-muted text-xs">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-oxblood text-xs">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

const controlClasses =
  'h-9 w-full rounded-[3px] border bg-paper-raised px-2.5 text-sm text-ink transition-colors duration-[120ms] placeholder:text-ink-faint hover:border-rule-strong disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-faint'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, id, ...props }, ref) {
    const field = useFieldContext()
    return (
      <input
        ref={ref}
        id={id ?? (field.controlId || undefined)}
        aria-describedby={props['aria-describedby'] ?? field.describedBy}
        aria-invalid={props['aria-invalid'] ?? (field.invalid || undefined)}
        className={cn(
          controlClasses,
          field.invalid ? 'border-oxblood' : 'border-rule',
          'aria-invalid:border-oxblood',
          className
        )}
        {...props}
      />
    )
  }
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, id, ...props }, ref) {
    const field = useFieldContext()
    return (
      <textarea
        ref={ref}
        id={id ?? (field.controlId || undefined)}
        aria-describedby={props['aria-describedby'] ?? field.describedBy}
        aria-invalid={props['aria-invalid'] ?? (field.invalid || undefined)}
        className={cn(
          controlClasses,
          'h-auto min-h-24 resize-y py-2 leading-relaxed',
          field.invalid ? 'border-oxblood' : 'border-rule',
          className
        )}
        {...props}
      />
    )
  }
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, id, children, ...props }, ref) {
    const field = useFieldContext()
    return (
      <select
        ref={ref}
        id={id ?? (field.controlId || undefined)}
        aria-describedby={props['aria-describedby'] ?? field.describedBy}
        aria-invalid={props['aria-invalid'] ?? (field.invalid || undefined)}
        className={cn(
          controlClasses,
          'cursor-pointer appearance-none pr-7',
          field.invalid ? 'border-oxblood' : 'border-rule',
          className
        )}
        style={{
          // Chevron drawn inline so there is no icon font or image request.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%235B6B70' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
          backgroundSize: '12px',
        }}
        {...props}
      >
        {children}
      </select>
    )
  }
)

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, ...props },
  ref
) {
  const control = (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'accent-moss size-4 shrink-0 cursor-pointer rounded-[2px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )

  if (!label) return control

  return (
    <label className="text-ink flex cursor-pointer items-center gap-2 text-sm">
      {control}
      {label}
    </label>
  )
})
