// Zoom-aware legend. One row per administrative level, each with its border
// style and the name of the area at the center of the map. The level being
// colored right now is highlighted with the palette; finer levels you haven't
// zoomed to yet are dimmed. Clicking a row zooms to that level.

import { LEVELS, PALETTE, levelAt } from './style.js';
import { AGENCIES } from './ownership.js';
import { contourSpacing } from './basemap.js';

// Border sample for each level, matching the line styles in style.js.
const LINE = {
  country: '<path d="M2 6h22" stroke="#6e6070" stroke-width="2.4"/>',
  region: '<path d="M2 6h22" stroke="#8f8296" stroke-width="1.4" stroke-dasharray="4.5 3"/>',
  county: '<path d="M2 6h22" stroke="#9d90a3" stroke-width="1.2" stroke-dasharray="6 2"/>',
  locality: '<path d="M2 6h22" stroke="#a497aa" stroke-width="1.2"/>',
  hood: '<path d="M2 6h22" stroke="#ab9fb1" stroke-width="1.2" stroke-dasharray="2 2.4"/>',
};

export function areaName(props) {
  try {
    const names = JSON.parse(props.names || '{}');
    if (names.common?.en) return names.common.en;
    if (names.primary) return names.primary;
  } catch { /* fall through */ }
  return props['@name'] || '';
}

export function initLegend(map, { countryName }) {
  const el = document.getElementById('legend');
  const rows = document.getElementById('legend-rows');
  const swatches = document.getElementById('legend-swatches');
  const caption = document.getElementById('legend-caption');
  const toggle = document.getElementById('legend-toggle');

  document.getElementById('legend-agencies').innerHTML = AGENCIES
    .map((a) => `<li><i style="background:${a.color}"></i>${a.label}</li>`).join('');

  swatches.innerHTML = PALETTE.map((c) => `<i style="background:${c}"></i>`).join('');
  rows.innerHTML = LEVELS.map((l) => `
    <li data-level="${l.key}">
      <button type="button" title="Zoom to ${l.plural.toLowerCase()}">
        <svg viewBox="0 0 26 12" aria-hidden="true">${LINE[l.key]}</svg>
        <span class="lg-kind">${l.name}</span>
        <span class="lg-name"></span>
      </button>
    </li>`).join('');

  // Collapsed state is a per-viewer convenience; default collapsed on phones.
  let collapsed = window.matchMedia('(max-width: 600px)').matches;
  try {
    const saved = localStorage.getItem('wpm.legend');
    if (saved !== null) collapsed = saved === '0';
  } catch { /* ignore */ }
  const setCollapsed = (v) => {
    collapsed = v;
    el.classList.toggle('collapsed', v);
    toggle.setAttribute('aria-expanded', String(!v));
    try { localStorage.setItem('wpm.legend', v ? '0' : '1'); } catch { /* ignore */ }
  };
  setCollapsed(collapsed);
  toggle.addEventListener('click', () => setCollapsed(!collapsed));

  rows.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-level]');
    if (!li) return;
    const i = LEVELS.findIndex((l) => l.key === li.dataset.level);
    const z = i === 0 ? Math.min(map.getZoom(), 3) : LEVELS[i].start + 0.7;
    map.flyTo({ zoom: z, duration: 1200, essential: true });
  });

  function update() {
    const zoom = map.getZoom();
    const focus = levelAt(zoom);
    const fi = LEVELS.indexOf(focus);

    // What's under the center of the map, at every level shown so far.
    const c = map.project(map.getCenter());
    const layers = LEVELS.slice(0, fi + 1).map((l) => l.fill).filter((id) => map.getLayer(id));
    const hits = map.queryRenderedFeatures([c.x, c.y], { layers });
    const found = {};
    for (const f of hits) {
      const lvl = LEVELS.find((l) => l.fill === f.layer.id);
      if (!lvl) continue;
      // Within a level, prefer the most specific subtype (e.g. a city over a township).
      const rank = lvl.subtypes.indexOf(f.properties.subtype);
      if (found[lvl.key] && found[lvl.key].rank >= rank) continue;
      const name = lvl.key === 'country' ? countryName(f) : areaName(f.properties);
      if (name) found[lvl.key] = { rank, name };
    }

    LEVELS.forEach((l, i) => {
      const li = rows.children[i];
      li.classList.toggle('focus', i === fi);
      li.classList.toggle('ahead', i > fi);
      li.querySelector('.lg-name').textContent = i <= fi ? (found[l.key]?.name || '—') : '';
    });
    caption.textContent = `Colors: ${focus.plural.toLowerCase()}`;
    el.dataset.focus = focus.key;
  }

  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  };
  map.on('moveend', schedule);
  // Cheap update while zooming so the highlighted level tracks the wheel.
  function setFocus() {
    const fi = LEVELS.indexOf(levelAt(map.getZoom()));
    [...rows.children].forEach((li, i) => {
      li.classList.toggle('focus', i === fi);
      li.classList.toggle('ahead', i > fi);
    });
    caption.textContent = `Colors: ${LEVELS[fi].plural.toLowerCase()}`;
  }
  setFocus();
  map.on('zoom', setFocus);
  map.on('idle', schedule);
  // Boundary tiles can land after the map first settles.
  let dataTimer = 0;
  map.on('sourcedata', (e) => {
    if (e.sourceId !== 'divisions' || !e.tile) return;
    clearTimeout(dataTimer);
    dataTimer = setTimeout(schedule, 250);
  });
  // A line about the base map in use (satellite credit, contour spacing).
  const viewNote = document.getElementById('legend-view');
  let view = 'map';
  function updateView() {
    if (view === 'satellite') {
      viewNote.textContent = 'Satellite imagery from Esri, softened so the colors still read.';
    } else if (view === 'terrain') {
      const c = contourSpacing(map.getZoom());
      viewNote.textContent = c
        ? `Contour lines every ${c.minor.toLocaleString()} ${c.unit}, bold every ${c.major.toLocaleString()} ${c.unit}.`
        : 'Hill shading shows the terrain. Zoom in for contour lines.';
    }
    viewNote.hidden = view === 'map';
  }
  map.on('zoomend', updateView);

  return {
    update: schedule,
    showLand(on) { document.getElementById('legend-land').hidden = !on; },
    showView(v) { view = v; updateView(); },
  };
}
