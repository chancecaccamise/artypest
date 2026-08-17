import { Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { entityHref } from './nav-config'
import { TypeBadge } from '@/components/ui/badge'
import { useAllEntities } from '@/hooks/use-data'
import { ENTITY_TYPE_LABELS } from '@/lib/data/types'
import { buildSearchIndex, groupHits, searchEntities, type SearchHit } from '@/lib/search'
import { cn } from '@/lib/utils'

/*
  Global search.

  A board member types an address from memory, so this matches words in any
  order across the name, the address, the parcel number, the county owner, and
  the neighbourhood. It searches every kind of record, not only lots.

  The index is built once from the loaded records rather than on each keystroke,
  because there are over ten thousand of them. Ranking lives in src/lib/search.ts
  and is tested there; this file is the keyboard and the markup.
*/

/** Enough to choose from without turning the panel into a directory page. */
const RESULT_LIMIT = 12

export function SearchBar({ className }: { className?: string }) {
  const navigate = useNavigate()
  const entities = useAllEntities()
  const listId = useId()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => entities.data ?? [], [entities.data])

  const index = useMemo(() => buildSearchIndex(rows), [rows])
  const byId = useMemo(() => new Map(rows.map((entity) => [entity.id, entity])), [rows])

  const hits = useMemo(
    () => searchEntities(index, byId, query, { limit: RESULT_LIMIT }),
    [index, byId, query]
  )
  const groups = useMemo(() => groupHits(hits), [hits])

  // The flat order the arrow keys walk, which is the grouped order read down.
  const ordered = useMemo(() => groups.flatMap((group) => group.hits), [groups])

  /*
    Position in that flat order, so the markup does not have to count as it
    renders. Keyed by record id because the groups are nested.
  */
  const positionById = useMemo(
    () => new Map(ordered.map((hit, at) => [hit.entity.id, at])),
    [ordered]
  )

  // Results shrink as the query narrows, so the highlight has to stay in range.
  const active = ordered.length === 0 ? 0 : Math.min(activeIndex, ordered.length - 1)

  // "/" focuses search, the convention this audience will already have from
  // every other tool they use.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      event.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // A click anywhere else closes the panel without clearing what was typed.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const go = (hit: SearchHit) => {
    navigate(entityHref(hit.entity.type, hit.entity.id))
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // First press closes the results, a second clears the box.
      if (open) setOpen(false)
      else setQuery('')
      return
    }

    if (ordered.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => (current + 1) % ordered.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => (current - 1 + ordered.length) % ordered.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = ordered[active]
      if (hit) go(hit)
    }
  }

  const showPanel = open && query.trim() !== ''
  const optionId = (position: number) => `${listId}-option-${String(position)}`

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search
        className="text-ink-faint pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search"
        aria-expanded={showPanel}
        aria-controls={showPanel ? listId : undefined}
        aria-activedescendant={
          showPanel && ordered.length > 0 ? optionId(active) : undefined
        }
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search addresses, people, lots, vendors"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cn(
          'border-rule bg-paper text-ink placeholder:text-ink-faint h-8 w-full rounded-[3px] border pr-14 pl-8 text-13',
          'transition-colors duration-[120ms] hover:border-rule-strong'
        )}
      />

      {query === '' ? (
        <kbd className="border-rule text-ink-faint pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[3px] border px-1 font-mono text-[0.6875rem]">
          /
        </kbd>
      ) : (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery('')
            inputRef.current?.focus()
          }}
          className="text-ink-faint hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 rounded-[3px] p-0.5"
        >
          <X className="size-4" />
        </button>
      )}

      {showPanel ? (
        <div className="panel panel-enter absolute top-full right-0 left-0 z-40 mt-1 max-h-[70vh] overflow-y-auto py-1">
          {ordered.length === 0 ? (
            <p className="text-ink-muted px-3 py-2 text-13">
              {entities.isLoading
                ? 'Loading records'
                : `Nothing matches "${query.trim()}". Try an address, a name, or a parcel number.`}
            </p>
          ) : (
            <ul role="listbox" id={listId} aria-label="Search results">
              {groups.map((group) => (
                <li key={group.type}>
                  <p
                    className="text-ink-faint px-3 pt-2 pb-1 text-[0.6875rem] tracking-wide uppercase"
                    // The group heading is decoration: the options carry the
                    // type themselves, so a screen reader is not read a label
                    // it cannot act on.
                    aria-hidden="true"
                  >
                    {group.label}
                  </p>
                  <ul>
                    {group.hits.map((hit) => {
                      const position = positionById.get(hit.entity.id) ?? 0
                      const highlighted = position === active
                      return (
                        <li key={hit.entity.id}>
                          <button
                            type="button"
                            id={optionId(position)}
                            role="option"
                            aria-selected={highlighted}
                            // Mouse down would blur the input before the click
                            // landed, closing the panel out from under it.
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => go(hit)}
                            onMouseEnter={() => setActiveIndex(position)}
                            className={cn(
                              'flex w-full items-center gap-2 px-3 py-1.5 text-left',
                              highlighted ? 'bg-paper-sunken' : 'bg-transparent'
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="text-ink block truncate text-13">
                                {hit.entity.name}
                              </span>
                              <span className="text-ink-muted block truncate text-xs">
                                {hit.document.detail}
                              </span>
                            </span>
                            <TypeBadge type={hit.entity.type}>
                              {ENTITY_TYPE_LABELS[hit.entity.type].singular}
                            </TypeBadge>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
