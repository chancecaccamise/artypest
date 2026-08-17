import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { buttonVariants } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { cn } from '@/lib/utils'

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="That page does not exist" />
      <Panel>
        <PanelBody className="flex flex-col items-start gap-3">
          <p className="text-ink-muted text-sm">
            The address you followed is not a page in this application. It may have been a record
            that was deleted, or a link that was typed by hand.
          </p>
          <Link to="/" className={cn(buttonVariants({ variant: 'primary' }))}>
            Go to the dashboard
          </Link>
        </PanelBody>
      </Panel>
    </>
  )
}
