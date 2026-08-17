# UI Specification

Information architecture, design system, and screen definitions. Read alongside `docs/BUILD-PLAN.md`.

> Status note, added when this was implemented on 2026-07-31. Two things in this
> document were deliberately departed from, both recorded in `DECISIONS.md`:
> the Connection Map was built rather than stubbed, because the user asked for
> it directly with a reference screenshot; and the tokens are mapped through
> Tailwind v4's `@theme` in `src/index.css` rather than `tailwind.config.ts`,
> because this project is on Tailwind v4, which has no JS config file.

---

## 1. Design direction

The audience is HOA board members and a property manager. Mostly 45 and up, non-technical, working on a laptop with occasional phone use. They are not going to be delighted by novelty. They will be delighted by density, legibility, and never having to ask where something is.

The subject world is not "software." It is **surveyor's plats and property records**: fine linework, monospace annotations, bearing and distance callouts, ink on cool paper stock, everything labeled and nothing decorated. That vernacular is where this product's visual identity comes from.

**Do not build the stock shadcn look.** Default slate-and-blue with a violet primary reads as a scaffold that nobody styled. Equally, do not reach for the current AI-design defaults: warm cream backgrounds with a serif display and terracotta accent, or near-black with a single acid accent. Neither belongs to this subject.

### Tokens

Define these as CSS custom properties in `src/index.css` and map them into `tailwind.config.ts`. Every color in the app comes from this list. No arbitrary hex values in components.

```css
:root {
  /* Surfaces: cool gray-green paper, not cream, not white */
  --paper:        #F1F3F0;   /* app background */
  --paper-raised: #FAFBF9;   /* cards, panels */
  --paper-sunken: #E6EAE5;   /* table headers, inset wells */

  /* Ink */
  --ink:          #1C2B31;   /* primary text, plat ink */
  --ink-muted:    #5B6B70;   /* secondary text, labels */
  --ink-faint:    #8FA0A3;   /* placeholders, disabled */

  /* Structure */
  --rule:         #C9D2CC;   /* hairline borders, 1px, used generously */
  --rule-strong:  #9AA8A0;

  /* Accents */
  --moss:         #3F5A4C;   /* primary action, live oak */
  --moss-hover:   #33493E;
  --survey:       #2E5C7A;   /* links, informational, blueprint blue */
  --oxblood:      #8C3A32;   /* destructive, overdue, expired */
  --amber:        #9A6E24;   /* warning, expiring soon */

  /* Entity type colors, used in badges now and the Connection Map later */
  --type-person:      #2E5C7A;
  --type-property:    #3F5A4C;
  --type-business:    #8A5A2B;
  --type-association: #6B4A7A;
  --type-asset:       #4A6B6B;
  --type-record:      #7A5A5A;
  --type-document:    #5B6B70;
}
```

Dark mode: invert surfaces to a deep slate-teal family (`#141C1F`, `#1C2831`, `#243139`), keep the accent hues, lighten `--rule` to `#33454A`. Do not use pure black or pure white anywhere in either theme.

### Type

Three roles, three faces. Load from Google Fonts via `@fontsource` packages so there is no runtime CDN dependency.

| Role | Face | Use |
|---|---|---|
| Display | **Bricolage Grotesque** | Page titles, entity names, stat figures. Weights 600 to 800. Used with restraint. |
| Body | **Public Sans** | All prose, labels, form fields, buttons, table cells. Weights 400 and 600. |
| Data | **IBM Plex Mono** | Identifiers, dates, currency, audit diffs. Weights 400 and 500. |

Public Sans is the US Web Design System face. On a civic records product that is a thematic fit, not a coincidence, and it is more legible at small sizes than Inter.

Scale: `12 / 13 / 14 / 16 / 20 / 26 / 34 / 44`. Body text is 14. Table cells are 13. Labels are 12 uppercase with `0.06em` tracking in `--ink-muted`.

### The signature element

**Monospace identifier chips.** Every entity carries a machine identifier, and it always renders the same way: IBM Plex Mono, 12px, `--ink-muted`, inside a 1px `--rule` border with 3px radius and 2px/6px padding.

- Property: the lot number and the SAGIS PIN
- Person: `member since 2019`
- Business: the entity type and state filing number
- Association: seat count
- Record: the record number

This is functionally correct as well as distinctive. PINs and lot numbers are codes, and codes belong in tabular figures. It is also the one visual motif that carries from the directory tables into the Connection Map in Phase 3.

### Restraint rules

- 1px hairline rules do the structural work. Shadows are used almost nowhere. At most one subtle shadow on floating overlays.
- Border radius is 3px on chips and inputs, 6px on cards. Never pill-shaped, never fully square.
- Motion is limited to 120ms color and border transitions plus 180ms panel entry. No scroll animations, no ambient effects, no page-load choreography. Respect `prefers-reduced-motion`.
- Dense by default. Table rows are 40px. This is a data tool and board members will be scanning 300 lots.

---

## 2. Navigation

Persistent left sidebar, collapsible to icons. Four labeled groups.

```
OVERVIEW
  Dashboard
  Activity

DIRECTORY
  People
  Properties
  Businesses
  Associations

COMMUNITY
  Assets
  Records
  Documents

TOOLS
  Connection Map     (Phase 3, empty state only)
  Parcel Import
  Settings
```

Each directory and community item shows a live count badge on the right in IBM Plex Mono.

Header: org name on the left, global search input in the center (non-functional placeholder in this phase, focusable with `/` but shows "Search arrives in Phase 2"), role switcher and theme toggle on the right.

**Connection Map** gets a nav entry and a route now. The page renders a designed empty state explaining what it will do, not a broken component and not a fake graph. Do not build the visualization.

---

## 3. Dashboard

The default landing page. Four rows.

### Row 1: Stat strip

Six tiles, single row on desktop, 2x3 on mobile. Figure in Bricolage Grotesque at 34px, label in 12px uppercase below it. No icons, no sparklines, no gradient. A hairline rule separates each tile.

| Tile | Value |
|---|---|
| Lots | count of `property` entities |
| Residents | count of `person` with a current `resides_at` relation |
| Owner-occupied | percentage where the resident is also an owner |
| Active vendors | count of `business` with a current `vendor_for` relation |
| Board seats | filled of total, rendered `5 / 7` |
| Open items | records with status not closed |

### Row 2: two-thirds and one-third

**Needs Attention** (two-thirds). The most valuable panel on the page. A flat list, each row linking to the record, sorted by urgency. Each row: an urgency tick (a 3px left border in `--oxblood` for overdue, `--amber` for approaching), the item description, and the relevant date in mono on the right.

Sources:
- Vendor contracts ending within 90 days
- Vendor insurance expiring within 60 days
- Board or committee terms ending within 90 days
- Records with status `open` past their follow-up date
- Properties with no current owner relation
- Properties with no SAGIS PIN recorded
- People with no email and no phone

Empty state: "Nothing needs attention right now." Not a celebration graphic.

**Board and Committees** (one-third). Grouped by association. Each row is a person's name, their role, and their term end date in mono. Roles ordered president, vice president, treasurer, secretary, then members.

### Row 3: two-thirds and one-third

**Recent Activity** (two-thirds). The last 20 audit entries, grouped under day headers. Each entry: actor, action verb, entity name as a link, and the changed field with old and new values in mono when it was an update. Link at the bottom to the full Activity page.

**Occupancy** (one-third). A single stacked horizontal bar plus a legend. Owner-occupied, long-term rental, short-term rental, vacant or unknown. Built with divs and the token colors. Do not install a chart library for this.

### Row 4

**Quick add** (half). Four buttons: Add Person, Add Property, Add Business, Add Record.

**Connection Map preview** (half). A card describing what the map will show, with a disabled "Open map" button and the text "Arrives in Phase 3." Design it properly. It is the thing you are selling.

Every widget needs a loading skeleton and an empty state.

---

## 4. Directory pages

One reusable page component driving all seven entity types, configured per type.

**List view**
- Page title, count, and a primary "Add" button
- Filter bar: type-specific dropdowns, an archived toggle, and a text filter
- Table with sortable columns, 40px rows, zebra striping using `--paper-sunken` at low opacity
- Identifier chip in its own column
- Row click opens the detail view
- Pagination at 50 per page
- Column set differs per entity type, defined in the page config

**Detail view**

Header: entity name in Bricolage Grotesque 34px, type badge, identifier chips, and an action menu with Edit, Archive, and Delete. Archived records show a persistent `--amber` banner with a Restore button.

Six tabs:

| Tab | Contents |
|---|---|
| **Details** | Field grid rendering the type's `data` schema. Two columns on desktop, one on mobile. Empty fields show a muted "Not set" rather than being hidden. Property records also render the Parcel Record card, section 6. |
| **Connections** | Grouped by relation type, showing the correct directional label. Current relations first, historical ones below a divider at 60% opacity. Read only in this phase, with an "Add connection" button disabled and labeled "Phase 2." |
| **Records** | Linked records, newest first. |
| **Files** | Attachments list. Upload disabled and labeled "Phase 2." |
| **Notes** | The internal `notes` field, plain textarea with autosave, never visible to a resident role. |
| **History** | The audit trail. Grouped by day, each entry showing timestamp, actor, action, field name, and old to new values in mono. Required, fully working, not a stub. |

---

## 5. Activity page

The global audit feed. Same rendering as the dashboard widget but full page, with filters for entity type, action type, actor, and date range. Paginate at 100.

---

## 6. SAGIS surfaces

The SAGIS API is **not being connected in this phase.** There is no endpoint, no network call, no credentials.

All SAGIS user interface is built now, against a local fixture. Put it behind a service interface so the real implementation is a drop-in later:

```
src/lib/parcels/
  types.ts               ParcelService interface + ParcelRecord type
  FixtureParcelService.ts   reads src/lib/parcels/fixtures/chatham-sample.json
  index.ts               exports the active service, single swap point
  SagisParcelService.ts     DOES NOT EXIST YET. Do not create it.
```

The fixture holds roughly 60 plausible Chatham County parcel records: PIN, situs address, owner name, owner mailing address, acreage, zoning district, assessed value, assessed year. About 40 should match the seeded properties by PIN so the import flow has real matches to resolve, and about 20 should be new so it has creates to perform.

### What is genuinely functional today

These three need no API and must actually work. Do not stub them.

1. **PIN validation.** Two valid formats: `20032 63001` with a space, and `10993C01034` where a letter takes the place of the space. Write it as a pure function with unit tests covering both shapes and common malformed input.

2. **Jurisdiction derivation.** A PIN starting with `2` is City of Savannah. A PIN starting with `1` is unincorporated Chatham County. Pure function from the PIN string, rendered as a badge next to the PIN chip. No lookup, no request.

3. **The outbound viewer link.** The PIN renders as a link to the SAGIS viewer, built from the URL template stored in organization settings. This is an anchor tag with a constructed href, nothing more. It opens in a new tab. If no template is configured, render the PIN as plain text rather than a dead link.

### Parcel Record card

On the Details tab of every property. Two-column field grid in mono:

PIN with jurisdiction badge and viewer link, situs address, acreage, zoning district, property use, assessed value, assessed year.

Footer row: **Source: entered manually** or **Source: imported from parcel data**, plus a "Last checked" line reading `Not connected` and a Refresh button that is **disabled** with the tooltip "Live parcel sync arrives when the SAGIS connection is configured."

Empty state when no PIN is recorded: a short line and an "Add parcel record" button opening the edit form focused on the PIN field.

### Parcel Import screen

Its own nav entry under Tools. Four steps, fully working against the fixture. Every write goes through the DataProvider so the whole import is audited like any other change.

**Step 1, Source.** Three options: paste a list of PINs, upload a CSV, or "Load sample neighborhood" which reads the fixture directly. A banner at the top of the screen reads: "Parcel data is loaded from a local sample file. Live SAGIS lookup is not connected yet." Plain statement, not an error style.

**Step 2, Preview.** Table of matched parcel records: PIN, address, owner, acreage, zoning, assessed value. Row checkboxes, select all, and a count of what is selected.

**Step 3, Match.** The important step. For each selected parcel, show the proposed action and let the user override it with a per-row select:

- **Create property** when the PIN is not already in the system
- **Update property** when the PIN matches an existing record, with the changed fields shown as an inline old-to-new diff in mono so nothing changes silently
- **Create owner** when the owner name does not match an existing person or business, with a name-normalized dedupe check that catches `SMITH, JOHN A` against `John A. Smith`
- **Link owner** when a match is found, showing which record it matched
- **Skip**

Owner records get classified as person or business by a simple heuristic on the name (LLC, INC, TRUST, LP, CORP, ASSOCIATION suggest a business). Show the classification and let the user change it per row.

**Step 4, Confirm.** Summary counts of properties to create, properties to update, owners to create, owners to link, ownership relations to create, and rows skipped. A single confirm button. Then a result screen with counts and a link to review the batch in Activity.

This screen is the highest-value thing to demo. It is also the piece that makes the product resellable to any HOA in a county publishing parcel data, so build it as though it is real, because everything except the data source is.

---

## 7. Settings page

Tabbed, all functional against the local provider.

- **Organization**: name, and the SAGIS viewer URL template with a live preview rendered from a sample PIN so the user can verify the link shape before saving
- **Integrations**: a SAGIS card showing status `Not connected`, a disabled endpoint field with placeholder text, and one sentence explaining that parcel data currently comes from a local sample. Do not add a Connect button that does nothing.
- **Reference data**: manage the lists for zoning, property use, association type, and record type. Add, rename, reorder, deactivate.
- **Relation types**: view the ten seeded types with their labels and reverse labels. Read only in this phase.
- **Appearance**: theme selection
- **Users**: the stubbed role list, read only, with a note that real accounts arrive with the backend

---

## 8. Quality floor

Not optional, not announced in the UI:

- Responsive to 375px. The sidebar collapses to a sheet, tables become stacked cards.
- Visible keyboard focus rings on every interactive element, using `--survey`.
- Every form field has a real `<label>`, and errors are associated with `aria-describedby`.
- Text contrast meets WCAG AA against its own surface.
- `prefers-reduced-motion` disables all transitions.
- Empty states say what to do next. Errors say what happened and how to fix it. Neither apologizes.
- Anywhere a feature is deliberately unavailable, the control is visibly disabled and labeled with when it arrives. Never a dead button, never a silent no-op.
