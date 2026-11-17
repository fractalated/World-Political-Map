// Map style for the World Political Map.
//
// Data (all fetched live, nothing is baked in):
//   - Political boundaries: Overture Maps Foundation "divisions" theme, newest
//     monthly release, discovered at load time (see app.js).
//   - Water, roads, places, labels: OpenFreeMap weekly OpenStreetMap build.
//   - Terrain shading: AWS Terrain Tiles (Mapzen terrarium DEM).

// Six muted, atlas-style hues. Countries that share a border never share a slot
// (see scripts/build-colors.mjs).
export const PALETTE = [
  '#f3bb84', // apricot
  '#bfd9a1', // sage
  '#efb5a6', // rose
  '#cbbfe6', // lavender
  '#f1e48f', // lemon
  '#acd5c6', // mint
];
const UNKNOWN_FILL = '#e9dcc4';

// The administrative levels, from countries down to neighborhoods. Each level
// becomes the "focus" (bright palette colors, shown in the legend) from its
// `start` zoom until the next level takes over; after that it fades to a pale
// wash under the finer level, so you can still tell where it is.
export const LEVELS = [
  { key: 'country', name: 'Country', plural: 'Countries', start: 0, subtypes: ['country', 'dependency'], fill: 'country-fill' },
  { key: 'region', name: 'State / province', plural: 'States & provinces', start: 4, subtypes: ['region'], fill: 'admin-fill-region' },
  { key: 'county', name: 'County / district', plural: 'Counties & districts', start: 8, subtypes: ['county'], fill: 'admin-fill-county' },
  { key: 'locality', name: 'City / town', plural: 'Cities & towns', start: 10.3, subtypes: ['localadmin', 'locality', 'borough'], fill: 'admin-fill-locality' },
  { key: 'hood', name: 'Neighborhood', plural: 'Neighborhoods', start: 12.3, subtypes: ['macrohood', 'neighborhood'], fill: 'admin-fill-hood' },
];
export const levelAt = (zoom) => LEVELS.reduce((cur, l) => (zoom >= l.start ? l : cur), LEVELS[0]);

// Mix a palette color toward the plain land color (t = 0 keeps it, 1 = land).
function mix(hex, t, toward = '#f3efe6') {
  const a = hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = toward.match(/\w\w/g).map((h) => parseInt(h, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const SOFT = PALETTE.map((c) => mix(c, 0.35)); // focus level at street zoom
const PALE = PALETTE.map((c) => mix(c, 0.68)); // a level that is no longer the focus

// Sub-national areas get their palette slot from admin-colors.js, which picks a
// slot no neighbor uses and stores it as feature-state "c". Until it has run,
// a slot hashed from the feature id is used (the same hash admin-colors.js
// prefers, so most areas never change color).
export const SLOT_HASH_DIVISOR = 1e9;
const SLOT = ['coalesce', ['feature-state', 'c'], ['%', ['floor', ['/', ['to-number', ['id'], 0], SLOT_HASH_DIVISOR]], PALETTE.length]];
const bySlot = (colors) => {
  const m = ['match', SLOT];
  colors.slice(0, -1).forEach((c, i) => m.push(i, c));
  m.push(colors[colors.length - 1]);
  return m;
};

const C = {
  land: '#f3efe6',
  ocean: '#a9cde0',
  oceanDeep: '#9cc4da',
  river: '#93c0d8',
  ice: '#fbfcfd',
  urban: '#e3dbd0',
  park: '#cfe3bf',
  border: '#6e6070',
  borderCasing: '#fbf8f2',
  state: '#8f8296',
  county: '#9d90a3',
  locality: '#a497aa',
  hood: '#ab9fb1',
  ink: '#3f3645',
  inkSoft: '#6a5f70',
  halo: 'rgba(251, 248, 242, 0.92)',
  waterInk: '#4f7c99',
  motorway: '#f4a65f',
  motorwayCase: '#c27a3e',
  trunk: '#f9cf86',
  trunkCase: '#c9a063',
  primary: '#ffffff',
  primaryCase: '#cdbfae',
};

const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']];
const FONT = {
  regular: ['Noto Sans Regular'],
  bold: ['Noto Sans Bold'],
  italic: ['Noto Sans Italic'],
};

// Exponential width ramp helper: zoom/width pairs.
const ramp = (...stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const lin = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];

function countryFill(colors, palette = PALETTE, unknown = UNKNOWN_FILL) {
  const entries = Object.entries(colors || {});
  if (!entries.length) return unknown;
  const match = ['match', ['get', 'country']];
  for (const [code, slot] of entries) match.push(code, palette[slot % palette.length]);
  match.push(unknown);
  return match;
}

// One fill layer per sub-national level.
function adminFill(level, next) {
  const s = level.start;
  const color = next
    ? ['interpolate', ['linear'], ['zoom'], next.start + 0.3, bySlot(PALETTE), next.start + 1.3, bySlot(PALE)]
    : ['interpolate', ['linear'], ['zoom'], s + 0.5, bySlot(PALETTE), 15.5, bySlot(SOFT)];
  return {
    id: level.fill,
    type: 'fill',
    source: 'divisions',
    'source-layer': 'division_area',
    minzoom: s - 0.01,
    filter: ['all', ['==', ['get', 'class'], 'land'], ['match', ['get', 'subtype'], level.subtypes, true, false]],
    layout: { 'fill-sort-key': ['index-of', ['get', 'subtype'], ['literal', level.subtypes]] },
    paint: {
      'fill-color': color,
      'fill-opacity': lin(s, 0, s + 0.5, 1),
      'fill-antialias': false,
    },
  };
}

// Outline of a sub-national level drawn from its areas (Overture only ships
// separate border lines for countries, states and counties).
function adminOutline(id, level, paint) {
  return {
    id,
    type: 'line',
    source: 'divisions',
    'source-layer': 'division_area',
    minzoom: level.start - 0.6,
    filter: ['all', ['==', ['get', 'class'], 'land'], ['match', ['get', 'subtype'], level.subtypes, true, false]],
    layout: { 'line-join': 'round' },
    paint,
  };
}

export function buildStyle({ overtureUrl, overtureRelease, colors }) {
  const isCountryArea = [
    'all',
    ['match', ['get', 'subtype'], ['country', 'dependency'], true, false],
    ['==', ['get', 'class'], 'land'],
  ];
  const roadClass = (...classes) => ['match', ['get', 'class'], classes, true, false];
  const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];

  return {
    version: 8,
    name: 'World Political',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sky: {
      'sky-color': '#0e1a2e',
      'horizon-color': '#a9cde0',
      'fog-color': '#dfeaf1',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.9,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
    sources: {
      osm: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
      divisions: {
        type: 'vector',
        url: `pmtiles://${overtureUrl}`,
        attribution:
          `Boundaries <a href="https://overturemaps.org" target="_blank">&copy; Overture Maps Foundation</a>` +
          (overtureRelease ? ` (${overtureRelease})` : ''),
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 12,
        attribution:
          'Terrain <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Mapzen / AWS Terrain Tiles</a>',
      },
    },
    layers: [
      // ---------- Base ----------
      { id: 'background', type: 'background', paint: { 'background-color': C.land } },

      {
        id: 'country-fill',
        type: 'fill',
        source: 'divisions',
        'source-layer': 'division_area',
        filter: isCountryArea,
        paint: {
          'fill-color': ['interpolate', ['linear'], ['zoom'],
            LEVELS[1].start + 0.3, countryFill(colors),
            LEVELS[1].start + 1.3, countryFill(colors, PALE, mix(UNKNOWN_FILL, 0.68))],
          'fill-antialias': false,
        },
      },
      {
        id: 'country-hover',
        type: 'fill',
        source: 'divisions',
        'source-layer': 'division_area',
        filter: ['all', isCountryArea, ['==', ['get', 'country'], '__none__']],
        paint: { 'fill-color': '#ffffff', 'fill-opacity': lin(0, 0.35, 8, 0.2, 10, 0) },
      },
      ...LEVELS.slice(1).map((l, i) => adminFill(l, LEVELS[i + 2])),

      {
        id: 'ice',
        type: 'fill',
        source: 'osm',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'ice'],
        paint: { 'fill-color': C.ice, 'fill-opacity': lin(0, 0.25, 8, 0.4) },
      },
      {
        id: 'urban',
        type: 'fill',
        source: 'osm',
        'source-layer': 'landuse',
        minzoom: 8,
        filter: ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood', 'commercial', 'retail', 'industrial'], true, false],
        paint: { 'fill-color': C.urban, 'fill-opacity': lin(8, 0, 9, 0.3, 13, 0.42) },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'osm',
        'source-layer': 'park',
        minzoom: 9,
        paint: { 'fill-color': C.park, 'fill-opacity': lin(9, 0, 10, 0.45, 14, 0.6) },
      },

      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': lin(0, 0.22, 4, 0.32, 8, 0.38, 12, 0.22, 14, 0.12),
          'hillshade-shadow-color': 'rgba(60, 45, 60, 0.55)',
          'hillshade-highlight-color': 'rgba(255, 255, 255, 0.18)',
          'hillshade-accent-color': 'rgba(60, 45, 60, 0.25)',
          'hillshade-illumination-direction': 315,
        },
      },

      // ---------- Water (drawn over land so coastlines & lakes come from OSM) ----------
      {
        id: 'water',
        type: 'fill',
        source: 'osm',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: {
          'fill-color': lin(0, C.oceanDeep, 6, C.ocean),
          'fill-antialias': true,
        },
      },
      {
        id: 'river',
        type: 'line',
        source: 'osm',
        'source-layer': 'waterway',
        minzoom: 5,
        filter: ['all', ['==', ['get', 'class'], 'river'], notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.river, 'line-width': ramp(5, 0.4, 9, 1, 14, 3.5), 'line-opacity': lin(5, 0, 6, 1) },
      },

      // ---------- Roads: only motorway / trunk / primary ----------
      {
        id: 'road-primary-case',
        type: 'line',
        source: 'osm',
        'source-layer': 'transportation',
        minzoom: 10,
        filter: ['all', roadClass('primary'), notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.primaryCase, 'line-width': ramp(10, 1.6, 14, 5, 16, 10), 'line-opacity': lin(10, 0, 11, 1) },
      },
      {
        id: 'road-trunk-case',
        type: 'line',
        source: 'osm',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: ['all', roadClass('trunk'), notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.trunkCase, 'line-width': ramp(8, 1.4, 12, 3.4, 14, 6, 16, 12), 'line-opacity': lin(8, 0, 9, 0.9) },
      },
      {
        id: 'road-motorway-case',
        type: 'line',
        source: 'osm',
        'source-layer': 'transportation',
        minzoom: 7,
        filter: ['all', roadClass('motorway'), notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.motorwayCase, 'line-width': ramp(7, 1.2, 12, 4, 14, 7, 16, 13), 'line-opacity': lin(7, 0, 8, 0.9) },
      },
      {
        id: 'road-primary',
        type: 'line',
        source: 'osm',
        'source-layer': 'transportation',
        minzoom: 9,
        filter: ['all', roadClass('primary'), notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.primary, 'line-width': ramp(9, 0.5, 14, 3.4, 16, 7.5), 'line-opacity': lin(9, 0, 10, 0.95) },
      },
      {
        id: 'road-trunk',
        type: 'line',
        source: 'osm',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: ['all', roadClass('trunk'), notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.trunk, 'line-width': ramp(6, 0.5, 12, 2.2, 14, 4.2, 16, 9) , 'line-opacity': lin(6, 0, 7, 1) },
      },
      {
        id: 'road-motorway',
        type: 'line',
        source: 'osm',
        'source-layer': 'transportation',
        minzoom: 5,
        filter: ['all', roadClass('motorway'), notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': lin(5, C.motorwayCase, 8, C.motorway),
          'line-width': ramp(5, 0.5, 8, 1.2, 12, 2.6, 14, 5, 16, 10),
          'line-opacity': lin(5, 0, 6, 0.85, 8, 1),
        },
      },

      // ---------- Political boundaries (Overture), finest first ----------
      adminOutline('hood-outline', LEVELS[4], {
        'line-color': C.hood,
        'line-width': lin(12, 0.5, 16, 1.3),
        'line-opacity': lin(11.7, 0, 12.4, 0.8),
        'line-dasharray': [1.5, 1.8],
      }),
      adminOutline('locality-outline', LEVELS[3], {
        'line-color': C.locality,
        'line-width': lin(10, 0.5, 13, 1.1, 16, 1.8),
        'line-opacity': lin(9.7, 0, 10.4, 0.85),
      }),
      {
        id: 'county-border',
        type: 'line',
        source: 'divisions',
        'source-layer': 'division_boundary',
        minzoom: 7.6,
        filter: ['all', ['==', ['get', 'subtype'], 'county'], ['==', ['get', 'class'], 'land']],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': C.county,
          'line-width': lin(8, 0.6, 10, 1, 14, 1.8),
          'line-opacity': lin(7.6, 0, 8.3, 0.85),
          'line-dasharray': [5, 1.5],
        },
      },
      {
        id: 'state-border',
        type: 'line',
        source: 'divisions',
        'source-layer': 'division_boundary',
        minzoom: 3,
        filter: ['all', ['==', ['get', 'subtype'], 'region'], ['==', ['get', 'class'], 'land']],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': C.state,
          'line-width': lin(3, 0.3, 6, 0.7, 10, 1.2, 14, 1.8),
          'line-opacity': lin(3, 0, 5, 0.5, 8, 0.8),
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'country-border-casing',
        type: 'line',
        source: 'divisions',
        'source-layer': 'division_boundary',
        minzoom: 2,
        filter: ['all', ['==', ['get', 'subtype'], 'country'], ['==', ['get', 'class'], 'land']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': C.borderCasing,
          'line-width': lin(2, 1.5, 6, 3.5, 10, 6, 14, 9),
          'line-opacity': lin(2, 0, 3, 0.55, 10, 0.6),
          'line-blur': 0.8,
        },
      },
      {
        id: 'country-border',
        type: 'line',
        source: 'divisions',
        'source-layer': 'division_boundary',
        filter: [
          'all',
          ['==', ['get', 'subtype'], 'country'],
          ['==', ['get', 'class'], 'land'],
          ['!', ['to-boolean', ['get', 'is_disputed']]],
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': C.border,
          'line-width': lin(0, 0.5, 3, 0.8, 6, 1.3, 10, 2, 14, 2.8),
          'line-opacity': 0.9,
        },
      },
      {
        id: 'country-border-disputed',
        type: 'line',
        source: 'divisions',
        'source-layer': 'division_boundary',
        filter: [
          'all',
          ['==', ['get', 'subtype'], 'country'],
          ['==', ['get', 'class'], 'land'],
          ['to-boolean', ['get', 'is_disputed']],
        ],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': C.border,
          'line-width': lin(0, 0.5, 3, 0.8, 6, 1.3, 10, 2, 14, 2.8),
          'line-opacity': 0.85,
          'line-dasharray': [2, 1.6],
        },
      },

      {
        id: 'admin-hover',
        type: 'line',
        source: 'divisions',
        'source-layer': 'division_area',
        filter: ['==', ['id'], -1],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': C.ink, 'line-width': 2.4, 'line-opacity': 0.55 },
      },

      // ---------- Labels ----------
      {
        id: 'label-ocean',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'water_name',
        filter: ['match', ['get', 'class'], ['ocean', 'sea'], true, false],
        layout: {
          'text-field': NAME,
          'text-font': FONT.italic,
          'text-size': ['interpolate', ['linear'], ['zoom'], 0, ['match', ['get', 'class'], 'ocean', 11, 9], 6, ['match', ['get', 'class'], 'ocean', 17, 13]],
          'text-letter-spacing': ['match', ['get', 'class'], 'ocean', 0.35, 0.18],
          'text-max-width': 6,
          'symbol-placement': 'point',
        },
        paint: { 'text-color': C.waterInk, 'text-halo-color': 'rgba(169, 205, 224, 0.6)', 'text-halo-width': 1 },
      },
      {
        id: 'label-lake',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'water_name',
        minzoom: 5,
        maxzoom: 12,
        filter: ['match', ['get', 'class'], ['lake', 'bay', 'strait'], true, false],
        layout: { 'text-field': NAME, 'text-font': FONT.italic, 'text-size': lin(5, 10, 12, 13), 'text-max-width': 7 },
        paint: { 'text-color': C.waterInk, 'text-halo-color': 'rgba(169, 205, 224, 0.6)', 'text-halo-width': 1 },
      },
      {
        id: 'label-river',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'waterway',
        minzoom: 9,
        filter: ['==', ['get', 'class'], 'river'],
        layout: {
          'text-field': NAME,
          'text-font': FONT.italic,
          'text-size': lin(9, 10, 14, 12.5),
          'symbol-placement': 'line',
          'symbol-spacing': 500,
          'text-letter-spacing': 0.1,
        },
        paint: { 'text-color': C.waterInk, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
      },
      {
        id: 'label-road-name',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'transportation_name',
        minzoom: 12,
        filter: roadClass('motorway', 'trunk', 'primary'),
        layout: {
          'text-field': NAME,
          'text-font': FONT.regular,
          'text-size': lin(12, 10, 16, 13),
          'symbol-placement': 'line',
          'symbol-spacing': 350,
          'text-max-angle': 30,
        },
        paint: { 'text-color': C.inkSoft, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'label-shield',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'transportation_name',
        minzoom: 7,
        filter: [
          'all',
          ['has', 'ref'],
          ['<=', ['to-number', ['get', 'ref_length'], 0], 7],
          roadClass('motorway'),
        ],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 7, 260, 12, 420],
          'text-field': ['get', 'ref'],
          'text-font': FONT.bold,
          'text-size': lin(7, 8.5, 12, 10.5),
          'text-rotation-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
          'icon-image': 'shield-motorway',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [1.5, 4, 1.5, 4],
        },
        paint: { 'text-color': '#5c3d22' },
      },
      {
        id: 'label-shield-trunk',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'transportation_name',
        minzoom: 9,
        filter: ['all', ['has', 'ref'], ['<=', ['to-number', ['get', 'ref_length'], 0], 7], roadClass('trunk')],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 420,
          'text-field': ['get', 'ref'],
          'text-font': FONT.bold,
          'text-size': lin(9, 9, 12, 10.5),
          'text-rotation-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
          'icon-image': 'shield-trunk',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [1.5, 4, 1.5, 4],
        },
        paint: { 'text-color': '#5c3d22' },
      },
      {
        id: 'label-suburb',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        minzoom: 11,
        filter: ['match', ['get', 'class'], ['suburb', 'quarter', 'neighbourhood'], true, false],
        layout: {
          'text-field': NAME,
          'text-font': FONT.regular,
          'text-size': lin(11, 9.5, 15, 12),
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.12,
          'text-max-width': 7,
          'symbol-sort-key': ['match', ['get', 'class'], 'suburb', 0, 1],
        },
        paint: { 'text-color': C.inkSoft, 'text-halo-color': C.halo, 'text-halo-width': 1.2, 'text-opacity': 0.85 },
      },
      {
        id: 'label-village',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        minzoom: 11,
        filter: ['==', ['get', 'class'], 'village'],
        layout: { 'text-field': NAME, 'text-font': FONT.regular, 'text-size': lin(11, 10, 15, 12.5), 'text-max-width': 7 },
        paint: { 'text-color': C.inkSoft, 'text-halo-color': C.halo, 'text-halo-width': 1.3 },
      },
      {
        id: 'label-town',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        minzoom: 8,
        filter: ['==', ['get', 'class'], 'town'],
        layout: {
          'text-field': NAME,
          'text-font': FONT.regular,
          'text-size': lin(8, 10, 12, 13, 15, 15),
          'icon-image': ['step', ['zoom'], 'town-dot', 11, ''],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': ['step', ['zoom'], 0.5, 11, 0],
          'text-justify': 'auto',
          'text-max-width': 8,
          'symbol-sort-key': ['to-number', ['get', 'rank'], 99],
        },
        paint: { 'text-color': C.ink, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'label-city',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        minzoom: 3,
        filter: ['==', ['get', 'class'], 'city'],
        layout: {
          'text-field': NAME,
          'text-font': ['match', ['get', 'capital'], 2, ['literal', FONT.bold], ['literal', FONT.regular]],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            3, ['match', ['get', 'capital'], 2, 10.5, 9.5],
            6, ['match', ['get', 'capital'], 2, 13, 11.5],
            10, ['step', ['to-number', ['get', 'rank'], 9], 17, 4, 15, 8, 13.5],
            14, ['step', ['to-number', ['get', 'rank'], 9], 21, 4, 18, 8, 16],
          ],
          'icon-image': ['step', ['zoom'], ['match', ['get', 'capital'], 2, 'capital-dot', 'city-dot'], 12, ''],
          'icon-size': lin(3, 0.8, 8, 1),
          'text-variable-anchor': ['left', 'right', 'top', 'bottom', 'top-right', 'bottom-left'],
          'text-radial-offset': ['step', ['zoom'], 0.55, 12, 0],
          'text-justify': 'auto',
          'text-max-width': 8,
          'symbol-sort-key': ['+', ['to-number', ['get', 'rank'], 9], ['match', ['get', 'capital'], 2, -5, 0]],
        },
        paint: { 'text-color': C.ink, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      {
        id: 'label-county',
        type: 'symbol',
        source: 'divisions',
        'source-layer': 'division',
        minzoom: 8,
        maxzoom: 11,
        filter: ['==', ['get', 'subtype'], 'county'],
        layout: {
          'text-field': ['get', '@name'],
          'text-font': FONT.italic,
          'text-size': lin(8, 10, 10.5, 12),
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.1,
          'text-max-width': 7,
          'text-padding': 6,
        },
        paint: { 'text-color': C.county, 'text-halo-color': C.halo, 'text-halo-width': 1.1, 'text-opacity': lin(8, 0, 8.5, 0.95, 10.5, 0.95, 11, 0) },
      },
      {
        id: 'label-state',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        minzoom: 3.5,
        maxzoom: 9,
        filter: ['==', ['get', 'class'], 'state'],
        layout: {
          'text-field': NAME,
          'text-font': FONT.italic,
          'text-size': lin(3.5, 9, 6, 11.5, 8, 13),
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.14,
          'text-max-width': 7,
          'symbol-sort-key': ['to-number', ['get', 'rank'], 9],
        },
        paint: { 'text-color': C.state, 'text-halo-color': C.halo, 'text-halo-width': 1, 'text-opacity': lin(3.5, 0, 4.5, 0.95) },
      },
      {
        id: 'label-country',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        maxzoom: 9,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': NAME,
          'text-font': FONT.bold,
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            0, ['step', ['to-number', ['get', 'rank'], 6], 9, 2, 8, 4, 7],
            1.5, ['step', ['to-number', ['get', 'rank'], 6], 11, 2, 9.5, 4, 8.5],
            4, ['step', ['to-number', ['get', 'rank'], 6], 16, 2, 14, 4, 12],
            7, ['step', ['to-number', ['get', 'rank'], 6], 21, 2, 19, 4, 17],
          ],
          'text-transform': 'uppercase',
          'text-letter-spacing': lin(1, 0.08, 6, 0.16),
          'text-max-width': ['interpolate', ['linear'], ['zoom'], 1, 6, 5, 8],
          'text-line-height': 1.1,
          'symbol-sort-key': ['to-number', ['get', 'rank'], 9],
        },
        paint: {
          'text-color': C.ink,
          'text-halo-color': C.halo,
          'text-halo-width': 1.5,
          'text-halo-blur': 0.5,
          'text-opacity': lin(7.5, 1, 9, 0),
        },
      },
    ],
  };
}
