import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IdChip, IdChipLink } from '@/components/ui/id-chip'
import { StatusBadge } from '@/components/ui/badge'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { Unavailable } from '@/components/ui/phase-note'
import { useReferenceLabels } from '@/hooks/use-reference-labels'
import { parcelService } from '@/lib/parcels'
import { buildParcelViewerUrl, deriveJurisdiction } from '@/lib/parcels/pin'
import type { Entity, Org } from '@/lib/data/types'
import { formatAcreage, formatCurrency, readNumber, readString } from '@/lib/format'

/*
  The parcel record for one property, on the Details tab.

  Nothing here calls anything. The PIN is validated locally, the jurisdiction
  is derived from the PIN's leading digit, and the viewer link is an anchor
  built from the template in organization settings. The Refresh control is
  visibly disabled and says when it will work.
*/

export interface ParcelRecordCardProps {
  property: Entity
  org: Org | undefined
  onAddParcelRecord: () => void
}

function value(property: Entity, key: string): string {
  return readString(property.data[key])
}

function numberValue(property: Entity, key: string): number | null {
  return readNumber(property.data[key])
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="label-caps text-[0.6875rem]">{label}</dt>
      <dd className="text-ink font-mono text-13">{children}</dd>
    </div>
  )
}

function NotSet() {
  return <span className="text-ink-faint font-sans">Not set</span>
}

export function ParcelRecordCard({ property, org, onAddParcelRecord }: ParcelRecordCardProps) {
  const { labelFor } = useReferenceLabels()
  const pin = value(property, 'pin')
  const jurisdiction = pin === '' ? null : deriveJurisdiction(pin)
  const viewerUrl = buildParcelViewerUrl(org?.sagisUrlTemplate, pin)
  const imported = value(property, 'parcelSource') === 'imported'

  const acreage = numberValue(property, 'acreage')
  const assessedValue = numberValue(property, 'assessedValue')
  const fairMarketValue = numberValue(property, 'fairMarketValue')
  const countyUpdatedAt = value(property, 'parcelUpdatedAt')
  const propertyUseCode = value(property, 'propertyUseCode')

  return (
    <Panel>
      <PanelHeader
        title="Parcel record"
        action={
          jurisdiction ? (
            <StatusBadge tone={jurisdiction === 'City of Savannah' ? 'survey' : 'moss'}>
              {jurisdiction}
            </StatusBadge>
          ) : null
        }
      />

      <PanelBody className="flex flex-col gap-4">
        {pin === '' ? (
          <EmptyState
            title="No parcel number recorded for this lot"
            description="Add the SAGIS parcel identification number to link this lot to the county record and derive its jurisdiction."
            action={<Button onClick={onAddParcelRecord}>Add parcel record</Button>}
          />
        ) : null}

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row label="Parcel number">
            {pin === '' ? (
              <NotSet />
            ) : viewerUrl ? (
              <IdChipLink href={viewerUrl} title="Open in the county parcel viewer, new tab">
                {pin}
              </IdChipLink>
            ) : (
              // No template configured, so the PIN is text rather than a dead link.
              <IdChip title="No parcel viewer URL is configured in Settings">{pin}</IdChip>
            )}
          </Row>
          <Row label="Situs address">{value(property, 'situsAddress') || <NotSet />}</Row>
          <Row label="Acreage">{acreage === null ? <NotSet /> : formatAcreage(acreage)}</Row>
          {/*
            The county publishes no zoning on the parcel. It is resolved by
            locating the parcel inside the zoning map, which covers the whole
            county, so a blank here means the lot fell outside every district
            rather than that its jurisdiction is unmapped.
          */}
          <Row label="Zoning district">{value(property, 'zoning') || <NotSet />}</Row>
          {/* Property use sits next to zoning on purpose: a commercial use
              inside a residential district is the mismatch this card exists
              to make obvious. */}
          <Row label="Property use">
            {property.data.propertyUse ? (
              <span className="font-sans">{labelFor('property_use', property.data.propertyUse)}</span>
            ) : (
              <NotSet />
            )}
          </Row>
          {/* The county's own class code, next to the association's own reading
              of the use. R3 against RSF-6 is the pair a board looks at. */}
          <Row label="County class code">
            {propertyUseCode === '' ? <NotSet /> : <IdChip>{propertyUseCode}</IdChip>}
          </Row>
          <Row label="Fair market value">
            {fairMarketValue === null ? <NotSet /> : formatCurrency(fairMarketValue)}
          </Row>
          {/* 40% of fair market value, which is Georgia's assessment ratio. */}
          <Row label="Assessed value">
            {assessedValue === null ? <NotSet /> : formatCurrency(assessedValue)}
          </Row>
        </dl>
      </PanelBody>

      <PanelFooter className="flex-wrap gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            Source:{' '}
            <span className="text-ink font-mono">
              {imported ? 'imported from parcel data' : 'entered manually'}
            </span>
          </span>
          <span>
            County last updated:{' '}
            <span className="text-ink-faint font-mono">
              {countyUpdatedAt === '' ? 'Unknown' : countyUpdatedAt}
            </span>
          </span>
        </div>

        <Unavailable reason="Live parcel sync arrives when the SAGIS connection is configured.">
          <Button size="sm" disabled aria-disabled="true">
            <RefreshCw />
            Refresh
          </Button>
        </Unavailable>
      </PanelFooter>

      {parcelService.connected ? null : (
        <div className="sr-only" role="note">
          Parcel data comes from a local sample file. The live SAGIS lookup is not connected.
        </div>
      )}
    </Panel>
  )
}
