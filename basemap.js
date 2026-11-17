// Base map views: the plain atlas map, satellite imagery, or terrain with
// contour lines. The political colors stay on top in every view.
//
//   - Satellite: Esri World Imagery (free to use with attribution). It is
//     desaturated and lightened, and the political colors are laid over it as
//     a translucent wash, so countries, states and counties still read by color.
//   - Terrain: stronger hill shading plus contour lines computed in the browser
//     (maplibre-contour) from the same free AWS elevation tiles that already
//     shade the hills. Labeled in feet in the US, meters elsewhere.

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const CONTOUR_LIB = 'https://unpkg.com/maplibre-contour@0.1.0/dist/index.min.js';

export const VIEWS = [
  { key: 'map', label: 'Map' },
  { key: 'satellite', label: 'Satellite' },
  { key: 'terrain', label: 'Terrain' },
];

// Feet for the US (and the two other countries still on them), meters elsewhere.
const FEET = (() => {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return ['US', 'LR', 'MM'].includes(region);
  } catch { return false; }
})();
const UNIT = FEET ? 'ft' : 'm';
// zoom: [minor, major] contour spacing
const THRESHOLDS = FEET
  ? { 10: [500, 2000], 11: [200, 1000], 12: [100, 500], 14: [40, 200], 15: [20, 100] }
  : { 10: [200, 1000], 11: [100, 500], 12: [50, 250], 14: [20, 100], 15: [10, 50] };
export function contourSpacing(zoom) {
  const z = Math.min(15, Math.floor(zoom));
  let t = null;
  for (const [k, v] of Object.entries(THRESHOLDS)) if (Number(k) <= z) t = v;
  return t && { minor: t[0], major: t[1], unit: UNIT };
}

// Layers from the atlas style that the imagery replaces.
const ATLAS_ONLY = ['ice', 'urban', 'park', 'hillshade'];

let libPromise = null;
function loadContourLib() {
  if (window.mlcontour) return Promise.resolve(window.mlcontour);
  libPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CONTOUR_LIB;
    s.onload = () => resolve(window.mlcontour);
    s.onerror = () => { libPromise = null; reject(new Error('contour library failed to load')); };
    document.head.append(s);
  });
  return libPromise;
}

export function initBasemap(map, { onChange } = {}) {
  const btn = document.getElementById('btn-view');
  const menu = document.getElementById('view-menu');
  let view = 'map';
  let atlasPaint = null; // original paint values we change, to restore
  let demSource = null;

  menu.innerHTML = VIEWS.map((v) => `
    <button type="button" role="menuitemradio" data-view="${v.key}" aria-checked="false">
      <span class="vm-thumb vm-${v.key}" aria-hidden="true"></span>${v.label}
    </button>`).join('');

  function remember() {
    if (atlasPaint) return;
    atlasPaint = {
      water: map.getPaintProperty('water', 'fill-opacity') ?? 1,
      hillshade: map.getPaintProperty('hillshade', 'hillshade-exaggeration'),
      shadow: map.getPaintProperty('hillshade', 'hillshade-shadow-color'),
    };
  }

  function addSatellite() {
    if (map.getLayer('satellite')) return;
    map.addSource('satellite', {
      type: 'raster',
      tiles: [IMAGERY],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery <a href="https://www.esri.com" target="_blank">Esri</a>, Maxar, Earthstar Geographics',
    });
    map.addLayer({
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      paint: {
        // Washed out: muted color, lifted shadows, so our palette sits on top.
        'raster-saturation': ['interpolate', ['linear'], ['zoom'], 3, -0.55, 14, -0.35],
        'raster-brightness-min': ['interpolate', ['linear'], ['zoom'], 3, 0.22, 14, 0.12],
        'raster-contrast': -0.08,
        'raster-fade-duration': 150,
      },
    }, 'country-fill');
  }

  async function addContours() {
    if (map.getSource('contours')) return;
    const mlcontour = await loadContourLib();
    if (map.getSource('contours')) return;
    demSource ||= new mlcontour.DemSource({ url: DEM, encoding: 'terrarium', maxzoom: 12, worker: true, cacheSize: 100 });
    demSource.setupMaplibre(maplibregl);
    map.addSource('contours', {
      type: 'vector',
      tiles: [demSource.contourProtocolUrl({
        multiplier: FEET ? 3.28084 : 1,
        thresholds: THRESHOLDS,
        contourLayer: 'contours',
        elevationKey: 'ele',
        levelKey: 'level',
      })],
      minzoom: 10,
      maxzoom: 15,
      attribution: 'Contours <a href="https://github.com/onthegomap/maplibre-contour" target="_blank">maplibre-contour</a>',
    });
    map.addLayer({
      id: 'contour-lines',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 10,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#8c6a4a',
        // Bold index lines (level 1) every few minor ones.
        'line-width': ['interpolate', ['linear'], ['zoom'],
          10, ['match', ['get', 'level'], 1, 0.7, 0.4],
          15, ['match', ['get', 'level'], 1, 1.3, 0.6]],
        'line-opacity': ['interpolate', ['linear'], ['zoom'],
          10, 0,
          10.6, ['match', ['get', 'level'], 1, 0.55, 0.32]],
      },
    }, 'road-primary-case');
    map.addLayer({
      id: 'contour-labels',
      type: 'symbol',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 11,
      filter: ['>', ['get', 'level'], 0],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 320,
        'text-field': ['concat', ['number-format', ['get', 'ele'], {}], FEET ? '′' : ' m'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-max-angle': 30,
      },
      paint: {
        'text-color': '#7a5a3c',
        'text-halo-color': 'rgba(251, 248, 242, 0.9)',
        'text-halo-width': 1.4,
      },
    }, 'label-road-name');
    // The user may have switched away while the library loaded.
    setVisible(['contour-lines', 'contour-labels'], view === 'terrain');
  }

  function setVisible(ids, v) {
    for (const id of ids) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    }
  }

  function apply() {
    remember();
    const sat = view === 'satellite';
    const ter = view === 'terrain';

    if (sat) addSatellite();
    setVisible(['satellite'], sat);
    setVisible(ATLAS_ONLY, !sat);
    // Let the imagery show through the sea, tinted blue.
    map.setPaintProperty('water', 'fill-opacity', sat ? 0.4 : atlasPaint.water);

    if (ter) {
      addContours().catch((err) => console.warn('Contour lines unavailable.', err));
      map.setPaintProperty('hillshade', 'hillshade-exaggeration',
        ['interpolate', ['linear'], ['zoom'], 0, 0.4, 4, 0.55, 8, 0.65, 12, 0.55, 15, 0.45]);
      map.setPaintProperty('hillshade', 'hillshade-shadow-color', 'rgba(55, 40, 50, 0.75)');
    } else {
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', atlasPaint.hillshade);
      map.setPaintProperty('hillshade', 'hillshade-shadow-color', atlasPaint.shadow);
    }
    setVisible(['contour-lines', 'contour-labels'], ter);

    document.body.dataset.view = view;
    btn.title = `Base map: ${VIEWS.find((v) => v.key === view).label}`;
    for (const b of menu.children) b.setAttribute('aria-checked', String(b.dataset.view === view));
    onChange?.(view);
  }

  function setView(v) {
    if (!VIEWS.some((x) => x.key === v)) v = 'map';
    view = v;
    try { localStorage.setItem('wpm.view', v); } catch { /* ignore */ }
    if (map.isStyleLoaded() || map.getLayer('water')) apply();
  }

  // ---- The menu ----
  const open = (v) => {
    menu.hidden = !v;
    btn.setAttribute('aria-expanded', String(v));
    if (v) menu.querySelector('[aria-checked="true"]')?.focus();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(menu.hidden); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    setView(b.dataset.view);
    open(false);
    btn.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.children];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    } else if (e.key === 'Escape') {
      open(false);
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) open(false);
  });

  let saved = 'map';
  try { saved = localStorage.getItem('wpm.view') || 'map'; } catch { /* ignore */ }
  view = VIEWS.some((x) => x.key === saved) ? saved : 'map';
  if (map.isStyleLoaded()) apply();
  else map.once('style.load', apply);

  return { get view() { return view; }, setView };
}
