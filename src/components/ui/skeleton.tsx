import { cn } from '@/lib/utils'

/*
  Loading placeholder. Pulses via a keyframe that prefers-reduced-motion
  flattens to a static block, which is why the base opacity is legible on its
  own rather than relying on the animation.
*/
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('bg-paper-sunken rounded-[3px]', className)}
      style={{ animation: 'skeleton-pulse 1.6s ease-in-out infinite' }}
    />
  )
}

/** Rows of skeleton bars sized like table rows, for list loading states. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  )
}
