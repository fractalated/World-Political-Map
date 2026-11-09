// Search: one box that accepts place names, addresses, landmarks, countries,
// ISO codes, coordinates in almost any notation, map links and Plus Codes.
//
// Coordinates are parsed locally (geoparse.js). Everything else goes to two
// free OpenStreetMap geocoders in parallel and the answers are merged:
//   - Photon (komoot):  typo-tolerant, good at partial / misspelled names
//   - Nominatim (OSM):  precise, ranks results by real-world importance
// If several places fit, a small chooser asks which one.

import { parseCoordinates, parsePlusCode, recoverPlusCode, formatLatLon } from './geoparse.js';

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const MAX_CHOICES = 8;

// ------------------------------------------------------------------ helpers
const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\bft\b/g, 'fort')
    .trim();

// State / province abbreviations so "Castle Rock CO" or "Halifax NS" match.
const REGION_ABBR = Object.fromEntries(Object.entries({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan',
  NSW: 'New South Wales', QLD: 'Queensland', VIC: 'Victoria', TAS: 'Tasmania', 'WA ': 'Western Australia',
  UK: 'United Kingdom', USA: 'United States', UAE: 'United Arab Emirates',
}).map(([k, v]) => [norm(v), norm(k)]));

const titleCase = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nominatim's usage policy allows one request per second; queue to respect it.
let nominatimNext = 0;
async function politeWait(url) {
  if (!String(url).startsWith(NOMINATIM)) return;
  const now = Date.now();
  const wait = Math.max(0, nominatimNext - now);
  nominatimNext = Math.max(now, nominatimNext) + 1100;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

async function getJson(url, ms = 7000) {
  await politeWait(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();

// Expand bare country codes ("FR", "jp") to names so geocoders find the country.
function expandQuery(q) {
  const t = q.trim().replace(/\bMt\.?(?=\s)/gi, 'Mount').replace(/\bFt\.?(?=\s)/gi, 'Fort');
  if (/^[A-Za-z]{2}$/.test(t) && regionNames) {
    const name = regionNames.of(t.toUpperCase());
    if (name && name.toUpperCase() !== t.toUpperCase()) return name;
  }
  return t;
}

// Kinds, their typical zoom, and how big a deal they are when ranking.
const KIND_ZOOM = {
  continent: 2.5, country: 4, state: 5.5, region: 6, province: 6, county: 8, district: 10,
  city: 11, municipality: 11, town: 12, borough: 12, suburb: 13, village: 13.5, hamlet: 14,
  quarter: 14, neighbourhood: 14.5, locality: 14, island: 9, archipelago: 6, street: 15.5,
  road: 15.5, house: 17, building: 17, postcode: 12,
};
const KIND_WEIGHT = {
  continent: 0.3, country: 0.25, state: 0.15, region: 0.1, province: 0.1, city: 0.12, town: 0.05,
};

function normalizeKind(k) {
  const kind = (k || '').toLowerCase();
  if (['administrative', 'boundary'].includes(kind)) return 'region';
  if (kind === 'census' || kind === 'census_designated') return 'town';
  if (kind === 'residential' || kind === 'primary' || kind === 'secondary' || kind === 'tertiary' ||
      kind === 'motorway' || kind === 'trunk') return 'road';
  return kind;
}

// ------------------------------------------------------------------ geocoders
function fromPhoton(f, i) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry.coordinates;
  const kind = normalizeKind(p.osm_key === 'place' || p.osm_key === 'boundary' ? (p.type === 'other' ? p.osm_value : p.type) : (['house', 'street'].includes(p.type) ? p.type : p.osm_value));
  let name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.street || p.city || p.country;
  if (p.housenumber && p.street && p.name && p.name !== p.street) name = p.name;
  else if (p.housenumber && p.street) name = `${p.housenumber} ${p.street}`;
  const context = [p.city !== name ? p.city : null, p.county && !p.city ? p.county : null, p.state !== name ? p.state : null, p.country !== name ? p.country : null]
    .filter(Boolean);
  const bbox = p.extent ? [p.extent[0], p.extent[3], p.extent[2], p.extent[1]] : null; // w,s,e,n
  return {
    name, context: [...new Set(context)].join(', '), kind, lat, lon, bbox,
    cc: (p.countrycode || '').toUpperCase(),
    importance: Math.max(0.05, 0.25 - i * 0.015),
    sources: ['photon'],
  };
}

function fromNominatim(r) {
  const a = r.address || {};
  let kind = normalizeKind(r.addresstype || r.type);
  // Big cities that OSM models as a district/suburb boundary (Paris, Berlin…)
  if (['suburb', 'district', 'borough', 'quarter', 'city_district'].includes(kind) &&
      (r.importance ?? 0) > 0.6 && r.category === 'boundary') kind = 'city';
  let name = r.name || r.display_name.split(',')[0];
  if (!r.name && a.road) name = [a.house_number, a.road].filter(Boolean).join(' ');
  const locality = a.city || a.town || a.village || a.hamlet || a.municipality;
  const context = [locality !== name ? locality : null, !locality ? a.county : null, a.state !== name ? a.state : null, a.country !== name ? a.country : null]
    .filter(Boolean);
  const bb = r.boundingbox?.map(Number); // [s, n, w, e]
  return {
    name, context: [...new Set(context)].join(', '), kind,
    lat: +r.lat, lon: +r.lon,
    bbox: bb ? [bb[2], bb[0], bb[3], bb[1]] : null,
    cc: (a.country_code || '').toUpperCase(),
    importance: r.importance ?? 0.2,
    sources: ['nominatim'],
  };
}

async function geocode(query, map) {
  const q = expandQuery(query);
  const c = map.getCenter();
  const photonUrl = new URL(PHOTON);
  photonUrl.searchParams.set('q', q);
  photonUrl.searchParams.set('limit', '12');
  photonUrl.searchParams.set('lang', 'en');
  if (map.getZoom() >= 5) {
    // Favor places near what you're looking at when zoomed in.
    photonUrl.searchParams.set('lat', c.lat.toFixed(3));
    photonUrl.searchParams.set('lon', c.lng.toFixed(3));
    photonUrl.searchParams.set('location_bias_scale', '0.3');
  }
  const nomUrl = new URL(`${NOMINATIM}/search`);
  nomUrl.searchParams.set('q', q);
  nomUrl.searchParams.set('format', 'jsonv2');
  nomUrl.searchParams.set('addressdetails', '1');
  nomUrl.searchParams.set('limit', '10');
  nomUrl.searchParams.set('accept-language', 'en');

  const [ph, nm] = await Promise.allSettled([getJson(photonUrl), getJson(nomUrl)]);
  if (ph.status === 'rejected' && nm.status === 'rejected') throw new Error('Search services unavailable');

  const list = [
    ...(nm.status === 'fulfilled' ? nm.value.map(fromNominatim) : []),
    ...(ph.status === 'fulfilled' ? ph.value.features.map(fromPhoton) : []),
  ].filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon));

  return rank(merge(list), query, q);
}

// Combine duplicates (same place from both services, or a city's node + boundary).
function merge(list) {
  const out = [];
  for (const r of list) {
    const n = norm(r.name);
    const dup = out.find((o) => norm(o.name) === n && (
      (o.kind === 'country' && r.kind === 'country' && o.cc === r.cc) ||
      (o.cc === r.cc && distanceKm(o, r) < (['state', 'region', 'province', 'county'].includes(r.kind) ? 150 : 40))
    ));
    if (!dup) { out.push({ ...r }); continue; }
    dup.importance = Math.max(dup.importance, r.importance) + 0.03;
    dup.sources = [...new Set([...dup.sources, ...r.sources])];
    if (!dup.bbox && r.bbox) dup.bbox = r.bbox;
    if (!dup.context && r.context) dup.context = r.context;
    if (!dup.kind) dup.kind = r.kind;
  }
  return out;
}

// Does the result match what was typed? "Paris" or "Paris, Texas" style.
function matchesQuery(r, ...queries) {
  const name = norm(r.name);
  const ctxParts = r.context.split(',').map(norm);
  const words = new Set(norm(`${r.context} ${r.cc}`).split(' '));
  for (const part of ctxParts) if (REGION_ABBR[part]) words.add(REGION_ABBR[part]);
  const ctx = ` ${[...words].join(' ')} ${ctxParts.join(' ')} `;
  const inCtx = (p) => ctx.includes(` ${p} `);
  return queries.some((q) => {
    const nq = norm(q);
    if (nq === name) return true;
    const parts = q.split(',').map(norm).filter(Boolean);
    if (parts.length > 1 && parts[0] === name) return parts.slice(1).every(inCtx);
    // "Castle Rock CO", "Paris Texas", "Springfield Illinois USA"
    if (nq.startsWith(name + ' ')) {
      const rest = nq.slice(name.length + 1);
      return inCtx(rest) || rest.split(' ').every(inCtx);
    }
    return false;
  });
}

function rank(list, typed, expanded) {
  const nq = norm(typed);
  for (const r of list) {
    r.exact = matchesQuery(r, typed, expanded);
    const n = norm(r.name);
    const ne = norm(expanded);
    // "Greater London", "City of London", "Mexico City" contain the whole query.
    r.partial = !r.exact && [nq, ne].some((q) => q && ` ${n} `.includes(` ${q} `));
    r.score = r.importance + (KIND_WEIGHT[r.kind] || 0) +
      (r.exact ? 0.35 : r.partial ? 0.25 : n.startsWith(nq) ? 0.1 : 0) +
      (r.sources.length > 1 ? 0.05 : 0);
  }
  return list.sort((a, b) => b.score - a.score);
}

// Pick a single answer when it's unambiguous; otherwise return null (ask the user).
// A rival only counts if it's a reasonably notable place in its own right, so
// "Eiffel Tower" goes straight to Paris but "Paris" asks France or Texas.
function decide(results) {
  if (results.length === 1) return { pick: results[0] };
  const exact = results.filter((r) => r.exact);
  const pool = exact.length ? exact : results;
  const top = pool[0];
  const bar = Math.min(0.45, top.importance * 0.75);
  const rivals = pool.slice(1).filter((r) => r.importance >= bar);
  // A more notable place whose name contains the query ("Greater London" for
  // "London"), or a far more notable one with a slightly different name.
  if (exact.length) {
    for (const r of results) {
      if (r.exact) continue;
      if ((r.partial && r.importance > Math.max(0.45, top.importance)) ||
          r.importance >= Math.max(0.45, top.importance + 0.2)) rivals.push(r);
    }
  }
  if (exact.length && !rivals.length) return { pick: top };
  const options = exact.length
    ? [top, ...rivals, ...results.filter((r) => r !== top && !rivals.includes(r) && r.score >= top.score - 0.5)]
    : results.filter((r) => r.score >= top.score - 0.6);
  return { options: [...new Set(options)].sort((a, b) => b.score - a.score) };
}

// ------------------------------------------------------------------ UI
export function initSearch(map, { highlightCountry } = {}) {
  const form = document.getElementById('search');
  const input = document.getElementById('search-input');
  const msg = document.getElementById('search-msg');
  const chooser = document.getElementById('chooser');
  const list = document.getElementById('chooser-list');
  let marker = null;
  let active = -1;
  let current = [];
  let busy = 0;

  const setBusy = (on) => form.classList.toggle('busy', on);
  function say(text) {
    msg.textContent = text || '';
    msg.classList.toggle('show', !!text);
    if (text) {
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    }
  }

  function clearMarker() {
    marker?.remove();
    marker = null;
  }

  function place(lat, lon, title, subtitle) {
    clearMarker();
    const el = document.createElement('div');
    el.className = 'pin';
    el.innerHTML = '<span class="pin-dot"></span><span class="pin-label"></span>';
    el.querySelector('.pin-label').innerHTML = `<b></b><small></small>`;
    el.querySelector('b').textContent = title;
    el.querySelector('small').textContent = subtitle || '';
    el.title = 'Click to dismiss';
    el.addEventListener('click', (e) => { e.stopPropagation(); clearMarker(); });
    marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(map);
  }

  function go(r) {
    closeChooser();
    const wide = r.bbox && (Math.abs(r.bbox[2] - r.bbox[0]) > 60 || Math.abs(r.bbox[3] - r.bbox[1]) > 45);
    const zoom = KIND_ZOOM[r.kind] ?? 14;
    if (r.bbox && !wide && r.bbox[0] !== r.bbox[2]) {
      map.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], {
        padding: { top: 80, bottom: 60, left: 40, right: 40 },
        maxZoom: Math.max(zoom, 12),
        duration: 1800,
        essential: true,
      });
    } else {
      map.flyTo({ center: [r.lon, r.lat], zoom: wide ? Math.min(zoom, 3.2) : zoom, duration: 1800, essential: true });
    }
    const isArea = ['country', 'continent', 'state', 'region', 'province'].includes(r.kind);
    if (r.kind === 'country' && r.cc) highlightCountry?.(r.cc);
    if (isArea) clearMarker();
    else place(r.lat, r.lon, r.name, r.context);
    input.blur();
  }

  function goCoords(c, label) {
    closeChooser();
    map.flyTo({ center: [c.lon, c.lat], zoom: c.zoom ?? Math.max(map.getZoom(), 12), duration: 1800, essential: true });
    const coordText = formatLatLon(c.lat, c.lon);
    place(c.lat, c.lon, label || coordText, label ? coordText : '');
    input.blur();
    if (!label) reverseName(c).then((name) => {
      const lbl = marker?.getElement().querySelector('.pin-label');
      if (name && lbl) { lbl.querySelector('b').textContent = coordText; lbl.querySelector('small').textContent = name; }
    });
  }

  async function reverseName(c) {
    try {
      const url = new URL(`${NOMINATIM}/reverse`);
      url.searchParams.set('lat', c.lat);
      url.searchParams.set('lon', c.lon);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('zoom', '12');
      url.searchParams.set('accept-language', 'en');
      const r = await getJson(url, 5000);
      if (!r?.address) return null;
      const a = r.address;
      return [a.city || a.town || a.village || a.hamlet || a.county, a.state, a.country].filter(Boolean).join(', ');
    } catch {
      return null;
    }
  }

  // ---- chooser
  function openChooser(results, query) {
    current = results.slice(0, MAX_CHOICES);
    active = 0;
    document.getElementById('chooser-title').textContent = `Which “${query}”?`;
    list.replaceChildren(...current.map((r, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `choice-${i}`;
      const kind = r.kind ? `<em></em>` : '';
      li.innerHTML = `<div class="c-main"><b></b>${kind}</div><small></small>`;
      li.querySelector('b').textContent = r.name;
      if (r.kind) li.querySelector('em').textContent = titleCase(r.kind);
      li.querySelector('small').textContent = r.context || formatLatLon(r.lat, r.lon);
      li.addEventListener('click', () => go(r));
      li.addEventListener('mousemove', () => setActive(i));
      return li;
    }));
    setActive(0);
    chooser.hidden = false;
    requestAnimationFrame(() => chooser.classList.add('open'));
  }
  function setActive(i) {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    list.children[i]?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', `choice-${i}`);
  }
  function closeChooser() {
    chooser.classList.remove('open');
    chooser.hidden = true;
    current = [];
    input.removeAttribute('aria-activedescendant');
  }

  // ---- main search
  async function run(raw) {
    const query = raw.trim();
    say('');
    closeChooser();
    if (!query) return;
    const ticket = ++busy;

    const coords = parseCoordinates(query);
    if (coords) return goCoords(coords);

    const plus = parsePlusCode(query);
    if (plus?.full) return goCoords(plus.full, query.toUpperCase());

    setBusy(true);
    try {
      if (plus?.short) {
        let ref = { lat: map.getCenter().lat, lon: map.getCenter().lng };
        if (plus.locality) {
          const near = await geocode(plus.locality, map);
          if (near[0]) ref = near[0];
        }
        if (ticket !== busy) return;
        return goCoords(recoverPlusCode(plus.short, ref.lat, ref.lon), plus.short + (plus.locality ? ` ${plus.locality}` : ''));
      }

      let results = await geocode(query, map);
      // Nothing? Try progressively looser versions of the query.
      if (!results.length && /[,\s]/.test(query)) {
        const looser = query.replace(/[^\p{L}\p{N}\s,]/gu, ' ').split(',')[0].trim();
        if (looser && looser !== query) results = await geocode(looser, map);
      }
      // Probably a typo: ask the precise geocoder about the closest name Photon found.
      if (results.length && !results.some((r) => r.exact)) {
        const guess = results.find((r) => r.sources.includes('photon'))?.name;
        if (guess && norm(guess) !== norm(query)) {
          const again = await geocode(guess, map);
          results = rank(merge([...again, ...results]), guess, expandQuery(guess));
        }
      }
      if (ticket !== busy) return;
      if (!results.length) return say(`Couldn’t find “${query}”`);
      const { pick, options } = decide(results);
      if (pick) go(pick);
      else openChooser(options, query);
    } catch (err) {
      console.warn(err);
      if (ticket === busy) say('Search is unavailable right now');
    } finally {
      if (ticket === busy) setBusy(false);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!chooser.hidden && current[active]) return go(current[active]);
    run(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (!chooser.hidden && current.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % current.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + current.length) % current.length); }
    }
    if (e.key === 'Escape') {
      if (!chooser.hidden) closeChooser();
      else if (input.value) input.value = '';
      else input.blur();
      say('');
    }
  });
  // Clicking back into the box selects the previous search so typing replaces it.
  input.addEventListener('focus', () => requestAnimationFrame(() => input.select()));
  input.addEventListener('input', () => { say(''); if (!chooser.hidden) closeChooser(); });

  document.getElementById('search-clear').addEventListener('click', () => {
    input.value = '';
    say('');
    closeChooser();
    clearMarker();
    input.focus();
  });

  // "/" or Ctrl/Cmd+K jumps to search from anywhere.
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  // Click anywhere on the map closes the chooser.
  map.on('mousedown', closeChooser);
  map.on('touchstart', closeChooser);
}
