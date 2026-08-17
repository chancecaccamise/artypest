import { useMemo } from 'react'

import { useReferenceItems } from './use-data'
import type { ReferenceItem, ReferenceList } from '@/lib/data/types'
import { humanize, readString } from '@/lib/format'
import type { LabelLookup } from '@/features/directory/config'

/*
  Stored values are slugs. Labels come from the org's reference lists, which
  the org can rename without rewriting a single entity, so the lookup has to
  happen at render time rather than at write time.

  A value with no reference row still renders: it falls back to a humanized
  slug, because showing `single_family` to a board member is not acceptable
  and neither is showing nothing.
*/
export interface ReferenceLabels {
  labelFor: LabelLookup
  /** Active options for one list, for filter and form selects. */
  optionsFor: (list: ReferenceList) => ReferenceItem[]
  isLoading: boolean
}

export function useReferenceLabels(): ReferenceLabels {
  const query = useReferenceItems()

  return useMemo(() => {
    const items = query.data ?? []

    const byKey = new Map<string, string>()
    for (const item of items) {
      byKey.set(`${item.list}:${item.value}`, item.label)
    }

    const labelFor: LabelLookup = (list, value) => {
      const raw = readString(value)
      if (raw === '') return ''
      return byKey.get(`${list}:${raw}`) ?? humanize(raw)
    }

    const optionsFor = (list: ReferenceList) =>
      items
        .filter((item) => item.list === list && item.active)
        .sort((a, b) => a.sortOrder - b.sortOrder)

    return { labelFor, optionsFor, isLoading: query.isLoading }
  }, [query.data, query.isLoading])
}
