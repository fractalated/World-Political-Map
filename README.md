# World Political Map

A full-screen, zoomable world political map that stays current with no manual
updates. Zoom from the whole planet down to city streets: the level of detail
adjusts as you go.

## Where the data comes from

| Layer | Source | How it stays current |
|---|---|---|
| **Country & territory boundaries** (fills, borders, disputed borders, states/provinces) | [Overture Maps Foundation](https://overturemaps.org) *divisions* theme, built from OpenStreetMap with quality checks | Each page load reads Overture's [release catalog](https://stac.overturemaps.org/catalog.json) and uses the newest monthly release |
| Water, highways, cities, place names | [OpenFreeMap](https://openfreemap.org) OpenStreetMap vector tiles | `tiles.openfreemap.org/planet` always points at the latest weekly build |
| Terrain shading | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen) | Static elevation |

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

- **World (0–3):** countries, country names, oceans, polar ice, soft terrain
- **Continent (3–6):** state/province borders, capitals and major cities, motorways
- **Region (6–10):** trunk highways with route shields, towns, rivers, urban areas
- **City (10–16):** primary roads, road names, neighborhoods, parks, waterways

Smaller streets are left out on purpose.

## Controls

The map itself has almost no visible chrome. Two small buttons sit in the
corner: **globe/flat** and **zoom to the whole world**. Hover over a country to
see its name. The URL updates as you move, so any view can be bookmarked or shared.

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
(ODbL) · Tiles by OpenFreeMap / OpenMapTiles · Terrain: Mapzen / AWS Terrain Tiles.
