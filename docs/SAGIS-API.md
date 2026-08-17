# SAGIS API

What the Savannah Area Geographic Information System actually serves, verified
live against the running service. This document should have existed before
`src/lib/parcels` was written against an invented fixture shape. It did not, so
several assumptions in that code are wrong. Those are called out below.

Investigated 2026-08-17. Every fact here was checked against the live service,
not inferred. Where a value is a real example it is a real example.

## The service

```
https://pub.sagis.org/arcgis/rest/services/
```

ArcGIS Server 11.5. Public, unauthenticated, no API key, no rate limit
observed.

**CORS is open.** The server reflects the request origin and sets
`vary: Origin`:

```
> Origin: http://localhost:5173
< access-control-allow-origin: http://localhost:5173
< access-control-allow-credentials: true
```

So the browser calls SAGIS directly. No proxy, no Supabase Edge Function, no
server-side relay, and no secret to keep out of the repo.

**`f=geojson` is supported** on the FeatureServer layers, and with `outSR=4326`
it returns WGS84 rings, so real geometry needs no conversion layer.

## Endpoints that matter

| Purpose | Path | Notes |
| --- | --- | --- |
| Parcel attributes | `OpenData/Parcels/FeatureServer/27` | "Parcel Digest 2025". 65 fields, 125,326 features. Native SR 2239 |
| Current parcel geometry | `BOA/BoaTy_Parcels/MapServer/1` | "Current Parcels". PIN and geometry only, no attributes. Live-edited. Native SR 3857 |
| Zoning districts | `Savannah/ZoningDevelopment_Map/MapServer/6` | `ZONE`, `CODE`, `ZONING_DISTRICT`. Polygons with no PIN |
| Address geocoder | `Locators/MAD_PointAddress_Centerlines/GeocodeServer` | `Geocode`, `ReverseGeocode`, `Suggest`. Native SR 2239 |
| Digital plat, city | `OpenData/DPLAT_SAV/MapServer` | Subdivisions on layer 8 |
| Digital plat, county | `OpenData/DPLAT_Chatham/MapServer` | Subdivisions on layer 9. Layer numbering differs from DPLAT_SAV |
| Historic parcels | `OpenData/Parcels/FeatureServer/0` to `/26` | One layer per year, 1998 through 2024. A real ownership history source |

`maxRecordCount` is 2000 on every layer checked, and
`advancedQueryCapabilities.supportsPagination` is true, so larger reads page
with `resultOffset` and `resultRecordCount`.

Other DPLAT layers, useful later: Common Areas, Easements, Building Setback
Lines, Right of Way, Buildings, Wetlands, Buffers, Benchmarks.

## Three PIN formats, not two

`CLAUDE.md` names two shapes and `src/lib/parcels/pin.ts` implements two. There
are at least three. All of these are real parcels:

```
20074 45001      11 chars, space at position 6
10025C01001      11 chars, letter in place of the space
10011 02012C     12 chars, space at position 6 AND a trailing letter
```

The third form is rejected by current validation. It is a real parcel at
106 San Marco Dr. The `PIN` field is declared `length 15`, so further variation
is possible and validation should be permissive about length rather than
pinning it to 11.

Jurisdiction from the leading digit (`2` City of Savannah, `1` unincorporated
Chatham County) held on every record sampled. `Municipality` is also published
directly as a zero-padded code, for example `020`, so the derivation can be
cross-checked rather than trusted blindly.

## Owner names, and why the import's Match step is wrong

`src/lib/parcels/owner.ts` normalises `SMITH, JOHN A` onto `John A. Smith`.
Counted against the live service:

| Query | Count |
| --- | --- |
| `Owner LIKE '%,%'` | 9,844 |
| `Owner NOT LIKE '%,%'` | 115,312 |

The comma form is 7.9% of the county. The real grammar, every line below a real
value from one block of E 46th St:

```
RANDALL ZOE                              SURNAME FIRST
BRUEN GARRETT JOHN                       SURNAME FIRST MIDDLE
SASEEN JOSEPH O.                         trailing period on the initial
BELZER NATHAN C & ALLISON S              SURNAME FIRST1 & FIRST2
KENNEDY MARY CLAYTON & AUSTIN O          same, with a two-word first name
LEVIN & WHITEHURST DARIA & SCOTT*        SURNAME1 & SURNAME2 FIRST1 & FIRST2
MCRAE COLIN A & LINDSAY M*               trailing asterisk marker
KAYE & FORESTER-PY COURTNEY FORESTER &   truncated mid-name at exactly 40 chars
ANDRESEN ROBERT A. &                     continues into Owner2
LIBERTY COMMERCIAL RENTALS LLC           organisation
MAYOR & ALDERMEN OF SAVANNAH             government, and the & is not a joint owner
WILSON C V VAN                           surname position genuinely ambiguous
GRANT SAVANNAH                           a person, and a place-name trap
```

Five things follow, and each one breaks something that currently exists:

1. **`&` is not a joint-owner delimiter.** Organisation names contain it
   (`MAYOR & ALDERMEN OF SAVANNAH`), so the person or business guess cannot key
   on it.
2. **Names are truncated at 40 characters.** The field is declared `length 50`,
   so the truncation happens upstream in the Board of Assessors system, not in
   transit. `KAYE & FORESTER-PY COURTNEY FORESTER &` ends on a dangling
   ampersand. Exact-string owner matching fails on any long name.
3. **`Owner` and `Owner2` must be read together.** Owner2 holds a co-owner, and
   sometimes the continuation of a truncated Owner.
4. **A trailing `*` is a record marker.** Meaning unconfirmed, likely the
   Stephens-Day or homestead flag. Strip it before matching either way.
5. **Some names cannot be parsed by rule.** `WILSON C V VAN` has no reliable
   surname boundary. These should be flagged low confidence and sent to the
   import's existing per-row override, not silently guessed.

## Zoning is a spatial join, not a field

`Parcel Digest 2025` has no zoning field. It has `Property_Use` and
`Land_Use_1` through `Land_Use_4`, which are different things. The historic 1998
layer does carry a `ZONING` column, which is the likely origin of the
assumption.

Zoning comes from intersecting the parcel against the zoning district layer.
Verified for 7 E 46th St:

```
point -81.102716,32.050046  ->  ZONE "RSF-6"
                                CODE "02"
                                ZONING_DISTRICT "Residential Single-family-6"
```

Two consequences. The real code is `RSF-6`, the post-NewZO format, so the `R-6`
values in the current fixture are in a format the county no longer publishes.
And that layer is City of Savannah only, so unincorporated county parcels have
no zoning polygon and must render as "not available" rather than blank.

This matters more than it looks. `CLAUDE.md` calls "commercial use in a
residential district" a core use case. It is a join across two services, not a
comparison of two columns on one record.

## Field inventory, Parcel Digest 2025

Identity and address:
`PIN`, `PropAddress_Full`, and nine components (`PropAddress_Num`, `_PreDir`,
`_StreetName`, `_StreetType`, `_PostDir`, `_UnitType`, `_UnitNum`, `_City`,
`_State`, `_Zip`). `PropAddress_Full` can have no street number: the city-owned
park parcel at PIN `20074 36001` is just `E 46TH ST`.

Ownership:
`Owner`, `Owner2`, `Mailing_Address`, `Mailing_City`, `Mailing_State`,
`Mailing_Zip`.

Value, and there are three different ones:
`FairMarketValue`, `FMV_Land`, `FMV_Building`, `Total_Assessment`,
`StephensDay_BYV`, `StephensDay_BYV_CPI`. `Total_Assessment` is exactly 40% of
`FairMarketValue`, which is Georgia's assessment ratio (verified: 648,440 of
1,621,100 and 187,040 of 467,600). Exempt parcels carry `Total_Assessment` 0
with a non-zero fair market value.

Classification:
`Property_Use`, `Land_Use_1` to `_4`, `Commercial_Cat`, `Nbhd_Code_BOA`,
`Municipality`.

Land and structure:
`Acres`, `YearBuilt` (frequently null, including on houses from the 1920s),
`Effective_YB`, `Land_Frontage_1` to `_4`, `Land_Units_1` to `_4`,
`Land_Type_1` to `_4`.

Sale history:
`Sale_Price`, `Sale_YY`, `Sale_MM`, `Sale_DD`, `Sale_Quality`, `Sale_Book`,
`Sale_Page`.

Districts:
`District_Lighting`, `District_Transit`, `District_DryTrash`,
`District_EnterpriseZone`, `District_TAD`.

Other:
`Legal_Description` (length 150), `Date_Updated` (epoch milliseconds, for
example `1746489600000` for 2025-05-06).

There is no assessment-year field. `Date_Updated` is the closest thing and is
what a "last checked" line should read from.

## Code tables that are not published

Neither field carries an ArcGIS coded-value domain, so the labels have to come
from the Board of Assessors separately.

`Property_Use` has 34 distinct values, letter plus digit:

```
A3 A4 A5 B4 C3 C4 C5 E0 E1 E2 E3 E4 E5 E6 E9 H3 I3 I4 I5
J3 J4 J5 R3 R4 R5 T3 U3 U4 U5 V3 V4 V5 W3   plus empty
```

The leading letter is the class (`R` residential, `C` commercial, `E` exempt,
`A` agricultural, `I` industrial, and so on). The digit is not confirmed. Do not
invent labels: render an unmapped code literally.

`Municipality` is a zero-padded numeric code (`020` for City of Savannah).

## Geocoding

The county's own address locator, which is better for this application than a
commercial geocoder because it is the authoritative source for the addresses in
question.

```
findAddressCandidates?SingleLine=7 E 46TH ST, SAVANNAH, GA&outSR=4326
  -> score 98.89
     "7 E 46TH ST, SAVANNAH, 31405"
     x -81.102716603612, y 32.050046587953
```

`Suggest` is supported, which is what an address autocomplete in the entity
forms would use. This removes any need for Mapbox geocoding.

## Geometry, and the winding-order question

`DECISIONS.md` records a fixed bug where clockwise rings made lots draw as the
entire rest of the world, because d3-geo reads a clockwise exterior ring as the
complement. The obvious worry is that real SAGIS data would reintroduce it,
since ArcGIS conventionally winds exterior rings clockwise.

It does not. Checked across 35 real parcels returned as `f=geojson`:

```
exterior rings counterclockwise: 35
exterior rings clockwise:         0
MultiPolygon features:            0
```

The `f=geojson` output is RFC 7946 compliant, rings are closed, and
`src/features/map/projection.ts` needs no change. Re-check this if the service
is ever read as `f=pjson` and converted by hand, because the ArcGIS native
`rings` format does not carry the same guarantee.

## The digital plat does not cover the client

`DPLAT_SAV` has 1,147 subdivisions and `DPLAT_Chatham` has 490. Neither has any
subdivision matching `%RDSLEY%`. DPLAT covers modern recorded subdivisions, and
Ardsley Park is a 1920s plat.

So DPLAT cannot be the plat view's geometry source. Parcel polygons cover the
whole county and have to be the base, with DPLAT layers (common areas,
easements, setback lines) as an enhancement where they exist.

## Reproducing any of this

Every check in this document is a single curl. For example, the owner-format
counts:

```sh
curl -s -G "https://pub.sagis.org/arcgis/rest/services/OpenData/Parcels/FeatureServer/27/query" \
  --data-urlencode "where=Owner NOT LIKE '%,%'" \
  --data-urlencode "returnCountOnly=true" \
  --data-urlencode "f=pjson"
```

and one real parcel with geometry:

```sh
curl -s -G "https://pub.sagis.org/arcgis/rest/services/OpenData/Parcels/FeatureServer/27/query" \
  --data-urlencode "where=PIN='20074 45001'" \
  --data-urlencode "outFields=*" --data-urlencode "outSR=4326" \
  --data-urlencode "f=geojson"
```
