# World Political Map

A full-screen, zoomable world political map that stays current with no manual
updates. Zoom from the whole planet down to city streets: the level of detail
adjusts as you go.

## Where the data comes from

| Layer | Source | How it stays current |
|---|---|---|
| **Political boundaries** (countries, states/provinces, counties, cities & towns, neighborhoods) | [Overture Maps Foundation](https://overturemaps.org) *divisions* theme, built from OpenStreetMap with quality checks | Each page load reads Overture's [release catalog](https://stac.overturemaps.org/catalog.json) and uses the newest monthly release |
| Water, highways, cities, place names | [OpenFreeMap](https://openfreemap.org) OpenStreetMap vector tiles | `tiles.openfreemap.org/planet` always points at the latest weekly build |
| Terrain shading and contour lines | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen); contours drawn in the browser by [maplibre-contour](https://github.com/onthegomap/maplibre-contour) | Static elevation |
| Satellite imagery (optional view) | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Esri refreshes the imagery itself |

The Overture Maps Foundation is a Linux Foundation project backed by Amazon,
Meta, Microsoft and TomTom. Its boundaries come from OpenStreetMap, plus Esri
Community Maps for some names, and are validated before each monthly release.

If the catalog can't be reached, the app uses the last release it saw, then a
known-good release built into `app.js`.

### Country colors

`data/country-colors.json` gives each country one of six colors so that no two
countries that share a border have the same color. A GitHub Action
(`.github/workflows/refresh-colors.yml`) rebuilds it every week from the latest
Overture release and commits any change. A brand-new country shows up right
away regardless, in a neutral color until the next refresh.

## What appears at each zoom level

The map colors one level of government at a time, and the level follows your
zoom. Neighbors at that level never share a color. Coarser levels stay
underneath as pale washes of their own hue, with their borders drawn heavier,
so you can always tell what's inside what.

| Zoom | Colored level | Also appears |
|---|---|---|
| 0–4 | Countries | country names, oceans, polar ice, soft terrain |
| 4–8 | States & provinces | state borders, capitals and major cities, motorways |
| 8–10.3 | Counties & districts | county borders and names, trunk highways, towns, rivers |
| 10.3–12.3 | Cities & towns | city limits, primary roads, villages, urban areas |
| 12.3+ | Neighborhoods | neighborhood outlines, road names, parks, waterways |

How deep it goes depends on what OpenStreetMap has mapped. Most of the US,
Europe and Japan have city limits, and many big cities have neighborhoods.
Where a level is missing, the next level up shows through.

Countries take their colors from `data/country-colors.json`. Smaller areas are
far too numerous for a prebuilt file, so `admin-colors.js` colors them in the
browser for whatever is on screen. It finds neighbors from shared border
points in the tiles, then gives each area the color its id hashes to, unless a
neighbor already has it. Colors stay put as you pan.

### The legend

The panel in the bottom-left corner is both the key and a "where am I"
readout. Each row is one level, with its border style and the name of the area
at the center of the map (e.g. *United States › Colorado › Douglas County ›
Parker*). The level being colored is highlighted. Click a row to zoom to it.
Hover the map to see the name of any area at the current level.

## Base map views

The layers button (top of the corner buttons) switches between three views.
The political colors stay on in all of them:

- **Map**: the normal atlas look.
- **Satellite**: Esri World Imagery, desaturated and lightened so the colors
  still read. The colors are laid over it as a see-through wash. Once a finer
  level takes over (a city inside a county, say), the coarser levels fade almost
  away, so the street-level photo stays clear.
- **Terrain**: stronger hill shading, plus contour lines from zoom 10 on, with
  elevation labels on the bold lines. Spacing tightens as you zoom in: in
  feet for US visitors (every 100 ft, bold every 500 ft at zoom 12), in meters
  elsewhere. The legend shows the current spacing.

The chosen view is remembered in the browser. Land ownership works on top of
any view.

## Land ownership

The parcel button (second of the corner buttons) turns on land ownership,
using only free public records:

| What | Source | Coverage |
|---|---|---|
| Public land shading, by managing agency | [BLM Surface Management Agency](https://www.blm.gov/services/geospatial) map tiles | All US |
| Public land details on click (unit, manager, public access) | [USGS PAD-US 4.1](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview) (falls back across USGS's copies when one is over its shared rate limit) | All US |
| Parcel lines | [State of Colorado public parcels](https://gis.colorado.gov/public/rest/services/Address_and_Parcel) | 44 of Colorado's 64 counties |
| Parcel owner, address, acres, parcel ID on click | Statewide parcel services | Colorado, Wisconsin, North Carolina, Florida, Vermont, Montana, Massachusetts, Connecticut, Texas, Arkansas; New York (about two thirds of counties share owners); Tennessee (all but Davidson, Shelby, Knox, Hamilton, Rutherford, Williamson, Montgomery, Chester and Hickman counties) |
| Parcel address, acres, parcel ID on click, no owner name | Statewide parcel services | New Jersey (owner names withheld by state law); Maryland (links to the state assessment record, which lists the owner) |

Click any land to see who owns or manages it; the parcel is outlined in red.
There is no free nationwide parcel source with owner names, so elsewhere
you'll see public land only. More states can be added to the `STATES` list in
`ownership.js`: each needs a keyless ArcGIS query URL and a field mapping
(Texas shows how to use a service that only allows `identify`).
Parcel records are public records, not surveys. Colorado's data asks for
attribution with the date accessed, which the popup shows.

## Controls

The map itself has little visible chrome. Four small buttons sit in the
corner: **base map view**, **land ownership**, **globe/flat** and **zoom to the whole world**,
plus the legend at bottom-left (it starts folded on phones). Hover over an
area to see its name. The URL updates as you move, so any view can be bookmarked or shared.

## Search

A small search box sits in the top-left corner (press `/` or `Ctrl/⌘ K` to jump
to it). It accepts almost anything:

- **Places:** cities, countries, states, landmarks, addresses, postcodes,
  mountains and lakes, e.g. `Paris`, `Castle Rock CO`, `Mt Everest`,
  `10 Downing Street London`, `80104`
- **Country codes:** `JP`, `FR`, `USA`
- **Typos:** `Lodnon`, `Germny`
- **Coordinates in any common notation:** `39.37, -104.86`, `-104.86 39.37`,
  `39°22'20"N 104°51'22"W`, `N 39 22.33 W 104 51.37`, `33.87° S, 151.21° E`,
  `48,8584; 2,2945`
- **Map links:** Google Maps, Apple Maps, OpenStreetMap, `geo:` URIs, or a link
  to this map
- **Plus Codes:** `8FW4V75V+8Q`, or a short code with a town: `V75V+8Q Paris`

Coordinates and Plus Codes are worked out in the browser (`geoparse.js`). Names
go to two free OpenStreetMap geocoders at once:
[Photon](https://photon.komoot.io), which tolerates typos, and
[Nominatim](https://nominatim.openstreetmap.org), which is precise and ranks
places by importance. The two result lists are merged. When several notable
places fit (`Paris`: France or Texas?), a small pop-up asks which one you
mean. Otherwise the map flies straight there and drops a pin.

## Run locally

```bash
npm start
```

Then open http://localhost:8080. It's a static site with no build step.

To rebuild country colors by hand:

```bash
npm install && npm run colors
```

## Attribution

Boundaries © Overture Maps Foundation · Map data © OpenStreetMap contributors
(ODbL) · Tiles by OpenFreeMap / OpenMapTiles · Terrain: Mapzen / AWS Terrain Tiles ·
Imagery: Esri, Maxar, Earthstar Geographics.
