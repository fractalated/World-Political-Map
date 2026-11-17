import { buildStyle, LEVELS, levelAt } from './style.js';
import { initSearch } from './search.js';
import { initAdminColors } from './admin-colors.js';
import { initLegend, areaName } from './legend.js';
import { initOwnership } from './ownership.js';

// ---------------------------------------------------------------------------
// 1. Find the newest Overture Maps boundary release (they publish monthly).
//    Falls back to the last release seen, then to a known-good release, so the
//    map always loads even if the catalog is briefly unreachable.
// ---------------------------------------------------------------------------
const STAC_ROOT = 'https://stac.overturemaps.org/catalog.json';
const FALLBACK = {
  release: '2026-10-21.0',
  url: 'https://tiles.overturemaps.org/2026-10-21.0/divisions.pmtiles',
};
const CACHE_KEY = 'wpm.overture';

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function writeCache(v) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}

async function fetchJson(url, ms = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function latestOverture() {
  try {
    const root = await fetchJson(STAC_ROOT);
    const release = root.latest;
    const cat = await fetchJson(`https://stac.overturemaps.org/${release}/divisions/catalog.json`);
    const link = cat.links.find((l) => l.rel === 'pmtiles');
    if (!link) throw new Error('No PMTiles link');
    const found = { release, url: link.href };
    writeCache(found);
    return found;
  } catch (err) {
    console.warn('Overture catalog unavailable, using cached/fallback release.', err);
    return readCache() || FALLBACK;
  }
}

async function loadColors() {
  try {
    const res = await fetch('data/country-colors.json', { cache: 'no-cache' });
    return (await res.json()).colors;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 2. Small hand-drawn map symbols (city dots, capital marks, highway shields).
// ---------------------------------------------------------------------------
const DPR = 2;
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w * DPR;
  c.height = h * DPR;
  const ctx = c.getContext('2d');
  ctx.scale(DPR, DPR);
  draw(ctx);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const IMAGES = {
  'city-dot': () => ({
    data: canvas(10, 10, (ctx) => {
      ctx.beginPath(); ctx.arc(5, 5, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = '#4b4251'; ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#fbf8f2'; ctx.stroke();
    }),
  }),
  'town-dot': () => ({
    data: canvas(8, 8, (ctx) => {
      ctx.beginPath(); ctx.arc(4, 4, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fbf8f2'; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#5a5060'; ctx.stroke();
    }),
  }),
  'capital-dot': () => ({
    data: canvas(14, 14, (ctx) => {
      ctx.beginPath(); ctx.arc(7, 7, 5.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fbf8f2'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#3f3645'; ctx.stroke();
      ctx.beginPath(); ctx.arc(7, 7, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#b8443a'; ctx.fill();
    }),
  }),
  'shield-motorway': () => shield('#fff4e6', '#c27a3e'),
  'shield-trunk': () => shield('#fffaf0', '#c9a063'),
};

function shield(fill, stroke) {
  const w = 24, h = 18;
  return {
    data: canvas(w, h, (ctx) => {
      roundRect(ctx, 1, 1, w - 2, h - 2, 4);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 1.3; ctx.strokeStyle = stroke; ctx.stroke();
    }),
    options: {
      pixelRatio: DPR,
      stretchX: [[6 * DPR, (w - 6) * DPR]],
      stretchY: [[6 * DPR, (h - 6) * DPR]],
      content: [4 * DPR, 3 * DPR, (w - 4) * DPR, (h - 3) * DPR],
    },
  };
}

// ---------------------------------------------------------------------------
// 3. The map.
// ---------------------------------------------------------------------------
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const [overture, colors] = await Promise.all([latestOverture(), loadColors()]);

// In flat view, never let the world shrink smaller than the screen.
const worldFitZoom = () => Math.max(0, Math.log2(window.innerHeight / 512));

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle({ overtureUrl: overture.url, overtureRelease: overture.release, colors }),
  center: [12, 28],
  zoom: worldFitZoom() + 0.15,
  minZoom: worldFitZoom(),
  maxZoom: 16.5,
  hash: true,
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
  renderWorldCopies: true,
  fadeDuration: 220,
});
map.touchZoomRotate.disableRotation();
window.map = map; // handy for poking around in the console

map.on('styleimagemissing', (e) => {
  const make = IMAGES[e.id];
  if (!make || map.hasImage(e.id)) return;
  const { data, options } = make();
  map.addImage(e.id, data, { pixelRatio: DPR, ...options });
});

// Collapse the attribution once the map has settled.
map.once('idle', () => {
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
});

// ---- Globe / flat toggle ----
let globe = false;
function setProjection(isGlobe) {
  globe = isGlobe;
  document.body.classList.toggle('globe', globe);
  document.getElementById('btn-globe').title = globe ? 'Switch to flat map' : 'Switch to globe view';
  map.setProjection({ type: globe ? 'globe' : 'mercator' });
  map.setMinZoom(globe ? 0.6 : worldFitZoom());
  try { localStorage.setItem('wpm.globe', globe ? '1' : '0'); } catch { /* ignore */ }
}
map.on('style.load', () => {
  let saved = false;
  try { saved = localStorage.getItem('wpm.globe') === '1'; } catch { /* ignore */ }
  if (saved) setProjection(true);
});
document.getElementById('btn-globe').addEventListener('click', () => setProjection(!globe));

document.getElementById('btn-world').addEventListener('click', () => {
  map.flyTo({ center: [12, 28], zoom: globe ? 1.4 : worldFitZoom() + 0.15, duration: 1600, essential: true });
});

window.addEventListener('resize', () => {
  if (!globe) map.setMinZoom(worldFitZoom());
});

// ---- Colors for states, counties, cities, neighborhoods ----
initAdminColors(map);

// ---- Hover: highlight the area at the level in focus and show its name ----
const tip = document.getElementById('tip');
const tipName = tip.querySelector('b');
const tipKind = tip.querySelector('small');
const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();
let hovered = null; // country code being highlighted
let hoveredArea = null; // sub-national feature id being outlined

function countryName(feature) {
  const code = feature.properties.country;
  try {
    const names = JSON.parse(feature.properties.names || '{}');
    if (names.common?.en) return names.common.en;
  } catch { /* fall through */ }
  return regionNames?.of(code) || feature.properties['@name'] || code;
}

function highlightFilter(code) {
  if (!map.getLayer('country-hover')) return;
  map.setFilter('country-hover', [
    'all',
    ['match', ['get', 'subtype'], ['country', 'dependency'], true, false],
    ['==', ['get', 'class'], 'land'],
    ['==', ['get', 'country'], code ?? '__none__'],
  ]);
}

function outlineArea(id) {
  if (id === hoveredArea || !map.getLayer('admin-hover')) return;
  hoveredArea = id;
  map.setFilter('admin-hover', ['==', ['id'], id ?? -1]);
}

function setHover(feature, level) {
  const isCountry = level?.key === 'country';
  const code = feature && isCountry ? feature.properties.country : null;
  if (code !== hovered) {
    hovered = code;
    highlightFilter(code);
  }
  outlineArea(feature && !isCountry ? feature.id : null);
  const name = feature ? (isCountry ? countryName(feature) : areaName(feature.properties)) : '';
  if (name) {
    tipName.textContent = name;
    tipKind.textContent = isCountry ? '' : level.name;
    tip.classList.add('show');
  } else {
    tip.classList.remove('show');
  }
}

if (window.matchMedia('(hover: hover)').matches) {
  map.on('mousemove', (e) => {
    // The finest area under the pointer, up to the level in focus (outside
    // city limits, say, that's the county).
    const fi = LEVELS.indexOf(levelAt(map.getZoom()));
    const layers = LEVELS.slice(0, fi + 1).map((l) => l.fill).filter((id) => map.getLayer(id));
    const rank = (f) => {
      const li = LEVELS.findIndex((l) => l.fill === f.layer.id);
      return li * 10 + LEVELS[li].subtypes.indexOf(f.properties.subtype);
    };
    const hits = map.queryRenderedFeatures(e.point, { layers });
    hits.sort((a, b) => rank(b) - rank(a));
    const f = hits[0] || null;
    setHover(f, f && LEVELS.find((l) => l.fill === f.layer.id));
  });
  map.on('mouseout', () => setHover(null));
  map.on('movestart', () => tip.classList.remove('show'));
}

// ---- Legend ----
const legend = initLegend(map, { countryName });

// ---- Land ownership & parcels ----
// While it's on, the political colors step back so agency colors read true.
const baseOpacity = {};
function dimPolitical(dim) {
  for (const l of LEVELS) {
    if (!map.getLayer(l.fill)) continue;
    if (!(l.fill in baseOpacity)) baseOpacity[l.fill] = map.getPaintProperty(l.fill, 'fill-opacity') ?? 1;
    const base = baseOpacity[l.fill];
    // Zoom curves must stay top-level, so scale their stop values instead.
    const scaled = typeof base === 'number' ? base * 0.4 : base.map((v, i) => (i > 3 && i % 2 === 0 ? v * 0.4 : v));
    map.setPaintProperty(l.fill, 'fill-opacity', dim ? scaled : base);
  }
}
initOwnership(map, {
  onChange(on) {
    legend.showLand(on);
    dimPolitical(on);
  },
});

// ---- Search ----
let flashTimer;
initSearch(map, {
  highlightCountry(code) {
    clearTimeout(flashTimer);
    hovered = code;
    if (map.isStyleLoaded()) highlightFilter(code);
    else map.once('idle', () => { if (hovered === code) highlightFilter(code); });
    flashTimer = setTimeout(() => {
      if (hovered === code) { hovered = null; highlightFilter(null); }
    }, 4000);
  },
});

console.info(`Boundaries: Overture Maps ${overture.release}\nBase map: OpenFreeMap (weekly OpenStreetMap build)`);
