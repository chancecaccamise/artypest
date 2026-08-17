import { Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Unavailable } from '@/components/ui/phase-note'

/*
  Attachments. Upload arrives with Supabase Storage in Phase 2, so the control
  is visibly disabled and says so rather than accepting a file and dropping it.
*/
export function FilesTab() {
  return (
    <Panel>
      <PanelHeader
        title="Files"
        action={
          <Unavailable reason="File upload arrives in Phase 2, with storage.">
            <Button size="sm" disabled aria-disabled="true">
              <Upload />
              Upload
            </Button>
          </Unavailable>
        }
      />
      <PanelBody>
        <EmptyState
          title="No files attached"
          description="Deeds, insurance certificates, and approved plans will attach here once storage is connected in Phase 2."
        />
      </PanelBody>
    </Panel>
  )
}
