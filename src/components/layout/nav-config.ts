import {
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  History,
  Landmark,
  Map,
  MapPinned,
  Network,
  Settings,
  Shapes,
  Users,
  type LucideIcon,
} from 'lucide-react'

import type { EntityType } from '@/lib/data/types'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Directory and community items show a live count from this entity type. */
  countType?: EntityType
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: Gauge },
      { label: 'Activity', to: '/activity', icon: History },
    ],
  },
  {
    label: 'Directory',
    items: [
      { label: 'People', to: '/people', icon: Users, countType: 'person' },
      { label: 'Properties', to: '/properties', icon: MapPinned, countType: 'property' },
      { label: 'Businesses', to: '/businesses', icon: Building2, countType: 'business' },
      { label: 'Associations', to: '/associations', icon: Landmark, countType: 'association' },
    ],
  },
  {
    label: 'Community',
    items: [
      { label: 'Assets', to: '/assets', icon: Shapes, countType: 'asset' },
      { label: 'Records', to: '/records', icon: ClipboardList, countType: 'record' },
      { label: 'Documents', to: '/documents', icon: FileText, countType: 'document' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Connection Map', to: '/map', icon: Network },
      { label: 'Plat View', to: '/plat', icon: Map },
      { label: 'Parcel Import', to: '/parcels', icon: MapPinned },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
]

/** Route segment per entity type, so a detail link can be built from a record. */
export const ENTITY_ROUTES: Record<EntityType, string> = {
  person: '/people',
  property: '/properties',
  business: '/businesses',
  association: '/associations',
  asset: '/assets',
  record: '/records',
  document: '/documents',
}

export function entityHref(type: EntityType, id: string): string {
  return `${ENTITY_ROUTES[type]}/${id}`
}
