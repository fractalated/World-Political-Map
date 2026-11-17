// Land ownership: who manages public land, and who owns a parcel.
//
// Everything here is free, keyless and public record, fetched live:
//   - Public land shading: BLM Surface Management Agency map tiles (all US).
//   - Public land details on click: USGS PAD-US 4.1 (all US).
//   - Parcel owners on click: statewide parcel services that publish owner
//     names (Colorado, Wisconsin, North Carolina, Florida, Vermont, Montana,
//     Massachusetts). There is no free nationwide source with owner names.
//   - Parcel lines: Colorado's statewide parcel map (44 of 64 counties).
//
// Nothing loads until the layer is switched on.

const BLM = 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer';
const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name_PADUS/FeatureServer/0';
const CO_PARCELS = 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/MapServer';

// Agency colors exactly as the BLM tiles draw them.
export const AGENCIES = [
  { code: 'USFS', label: 'Forest Service', color: '#ccebc5' },
  { code: 'BLM', label: 'BLM', color: '#fee679' },
  { code: 'NPS', label: 'National Parks', color: '#cabddc' },
  { code: 'FWS', label: 'Fish & Wildlife', color: '#7fcca7' },
  { code: 'ST', label: 'State', color: '#b3e3ee' },
  { code: 'LG', label: 'Local govt.', color: '#8fb5be' },
  { code: 'DOD', label: 'Military', color: '#fbb4ce' },
  { code: 'BIA', label: 'Tribal', color: '#fdb46c' },
  { code: 'BOR', label: 'Reclamation', color: '#ffffb3' },
];

const AGENCY_NAMES = {
  USFS: 'U.S. Forest Service',
  BLM: 'Bureau of Land Management',
  NPS: 'National Park Service',
  FWS: 'U.S. Fish & Wildlife Service',
  USBR: 'Bureau of Reclamation',
  BOR: 'Bureau of Reclamation',
  BIA: 'Bureau of Indian Affairs',
  DOD: 'Department of Defense',
  DOE: 'Department of Energy',
  ARS: 'Agricultural Research Service',
  NRCS: 'Natural Resources Conservation Service',
  TVA: 'Tennessee Valley Authority',
  USACE: 'Army Corps of Engineers',
  SLB: 'State Land Board',
  SDC: 'State Dept. of Conservation',
  SDNR: 'State Dept. of Natural Resources',
  SDOL: 'State Dept. of Land',
  SFW: 'State Fish & Wildlife',
  SPR: 'State Parks & Recreation',
  CITY: 'City',
  CNTY: 'County',
  JNT: 'Joint',
  NGO: 'Nonprofit',
  PVT: 'Private',
  TRIB: 'Tribal',
  UNK: 'Unknown',
};
const ACCESS = { OA: 'Open to the public', RA: 'Restricted access', XA: 'Closed to the public', UK: 'Access unknown' };

// Statewide parcel services with owner names. `bbox` is a rough state box
// (west, south, east, north) used only to decide which services to ask.
const accessed = new Date().toISOString().slice(0, 10);
const STATES = [
  {
    state: 'Colorado', bbox: [-109.07, 36.99, -102.04, 41.01], url: `${CO_PARCELS}/0`,
    credit: `State of Colorado public parcels, accessed ${accessed}, gis.colorado.gov`,
    map: (p) => ({
      owner: p.owner, owner2: p.owner2, address: join(p.situsAdd, p.sitAddCty), acres: p.landAcres,
      id: p.parcel_id || p.account, county: p.countyName && `${p.countyName} County`, use: p.landUseDsc, link: p.URL,
    }),
  },
  {
    state: 'Wisconsin', bbox: [-92.9, 42.49, -86.8, 47.31],
    url: 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0',
    credit: 'Wisconsin Statewide Parcel Map (SCO / Wisconsin DOA)',
    map: (p) => ({
      owner: p.OWNERNME1, owner2: p.OWNERNME2, address: join(p.SITEADRESS, p.PLACENAME), acres: p.GISACRES || p.DEEDACRES,
      id: p.PARCELID || p.TAXPARCELID, county: p.CONAME && `${titleCase(p.CONAME)} County`,
      use: WI_CLASS[String(p.PROPCLASS || p.AUXCLASS || '').split(',')[0].trim()],
    }),
  },
  {
    state: 'North Carolina', bbox: [-84.33, 33.84, -75.4, 36.59],
    url: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1',
    credit: 'NC OneMap statewide parcels',
    map: (p) => ({
      owner: p.ownname, owner2: p.ownname2, address: join(p.siteadd, p.scity), acres: p.gisacres,
      id: p.parno, county: p.cntyname && `${titleCase(p.cntyname)} County`, use: p.parusedesc,
    }),
  },
  {
    state: 'Florida', bbox: [-87.64, 24.4, -79.97, 31.0],
    url: 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0',
    credit: 'Florida Dept. of Revenue statewide cadastral',
    map: (p) => ({
      owner: p.OWN_NAME, address: join(p.PHY_ADDR1, p.PHY_CITY), acres: p.LND_SQFOOT ? p.LND_SQFOOT / 43560 : null,
      id: p.PARCEL_ID,
    }),
  },
  {
    state: 'Vermont', bbox: [-73.44, 42.72, -71.46, 45.02],
    url: 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0',
    credit: 'Vermont Center for Geographic Information parcels',
    map: (p) => ({
      owner: p.OWNER1, owner2: p.OWNER2, address: join(p.E911ADDR, p.TNAME), acres: p.ACRESGL, id: p.SPAN, use: p.DESCPROP,
    }),
  },
  {
    state: 'Montana', bbox: [-116.05, 44.36, -104.04, 49.0],
    url: 'https://services.arcgis.com/qnjIrwR8z5Izc0ij/arcgis/rest/services/Montana_Cadastral_Framework/FeatureServer/1',
    credit: 'Montana Cadastral Framework (MSDI)',
    map: (p) => ({
      owner: p.OwnerName, address: join(p.AddressLine1, p.CityStateZip), acres: p.TotalAcres || p.GISAcres,
      id: p.PARCELID, county: p.CountyName && `${p.CountyName} County`, use: p.PropType,
    }),
  },
  {
    state: 'Massachusetts', bbox: [-73.51, 41.23, -69.93, 42.89],
    url: 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0',
    credit: 'MassGIS property tax parcels',
    map: (p) => ({
      owner: p.OWNER1, address: join(p.SITE_ADDR, p.CITY), id: p.MAP_PAR_ID || p.LOC_ID, use: p.USE_DESC,
    }),
  },
];

// Wisconsin property class codes.
const WI_CLASS = {
  1: 'Residential', 2: 'Commercial', 3: 'Manufacturing', 4: 'Agricultural', 5: 'Undeveloped',
  '5M': 'Agricultural forest', 6: 'Productive forest', 7: 'Other', W1: 'Exempt (federal)', W2: 'Exempt (state)',
  W3: 'Exempt (county)', W4: 'Exempt (other)', W5: 'Exempt (other)', W6: 'Exempt (other)', W7: 'Exempt (other)',
  W8: 'Exempt (other)', W9: 'Exempt (other)', X1: 'Exempt (federal)', X2: 'Exempt (state)', X3: 'Exempt (county)', X4: 'Exempt (other)',
};

function join(...parts) {
  return parts.filter((s) => s && String(s).trim()).map((s) => String(s).trim()).join(', ');
}
function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
const fmtAcres = (a) => (a >= 100 ? Math.round(a).toLocaleString() : a >= 1 ? a.toFixed(1) : a.toFixed(2));

// Area of a GeoJSON polygon in acres (spherical approximation).
function acresOf(geom) {
  if (!geom) return 0;
  const R = 6378137;
  const rad = Math.PI / 180;
  const ringArea = (ring) => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
    }
    return Math.abs((a * R * R) / 2);
  };
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  let m2 = 0;
  for (const rings of polys) rings.forEach((r, i) => { m2 += i === 0 ? ringArea(r) : -ringArea(r); });
  return m2 / 4046.8564224;
}

async function queryPoint(url, lngLat, { geometry = true, signal } = {}) {
  const params = new URLSearchParams({
    geometry: `${lngLat.lng},${lngLat.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: String(geometry),
    outSR: '4326',
    // (No resultRecordCount: it makes some servers sort and page, ~100x slower.)
    f: 'geojson',
  });
  const res = await fetch(`${url}/query?${params}`, { signal });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'query failed');
  return data.features || [];
}

// Outline-only rendering of Colorado's parcels, drawn by the state's server.
function coParcelTiles() {
  const dynamicLayers = JSON.stringify([{
    id: 0,
    source: { type: 'mapLayer', mapLayerId: 0 },
    drawingInfo: {
      renderer: {
        type: 'simple',
        symbol: {
          type: 'esriSFS',
          style: 'esriSFSNull',
          outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [94, 80, 98, 255], width: 0.75 },
        },
      },
    },
  }]);
  return `${CO_PARCELS}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&dpi=192` +
    `&format=png32&transparent=true&f=image&dynamicLayers=${encodeURIComponent(dynamicLayers)}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function initOwnership(map, { onChange } = {}) {
  const btn = document.getElementById('btn-land');
  let on = false;
  let popup = null;
  let ctrl = null;

  function addLayers() {
    if (map.getSource('sma')) return;
    map.addSource('sma', {
      type: 'raster',
      tiles: [`${BLM}/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 14,
      attribution: 'Public land <a href="https://www.blm.gov/services/geospatial" target="_blank">BLM</a>, ' +
        '<a href="https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview" target="_blank">USGS PAD-US</a>',
    });
    map.addSource('co-parcels', {
      type: 'raster',
      tiles: [coParcelTiles()],
      tileSize: 256,
      minzoom: 14,
      maxzoom: 20,
      bounds: STATES[0].bbox,
      attribution: `Parcels: ${STATES[0].credit}`,
    });
    map.addSource('own-pick', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
      id: 'public-land',
      type: 'raster',
      source: 'sma',
      minzoom: 5,
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 6, 0.8, 12, 0.75, 16, 0.6],
        'raster-fade-duration': 150,
      },
    }, 'water');
    map.addLayer({
      id: 'co-parcels',
      type: 'raster',
      source: 'co-parcels',
      minzoom: 14,
      paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.6, 0.75, 17, 0.9] },
    }, 'hood-outline');
    map.addLayer({
      id: 'own-pick-fill',
      type: 'fill',
      source: 'own-pick',
      paint: { 'fill-color': '#fffbe6', 'fill-opacity': 0.35 },
    }, 'label-ocean');
    map.addLayer({
      id: 'own-pick-line',
      type: 'line',
      source: 'own-pick',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#b8443a', 'line-width': 2.4 },
    }, 'label-ocean');
  }

  function setVisible(v) {
    for (const id of ['public-land', 'co-parcels', 'own-pick-fill', 'own-pick-line']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    }
  }

  function setOn(v) {
    on = v;
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Hide land ownership' : 'Show land ownership';
    document.body.classList.toggle('land', on);
    if (on) addLayers();
    setVisible(on);
    if (!on) closePopup();
    try { localStorage.setItem('wpm.land', on ? '1' : '0'); } catch { /* ignore */ }
    onChange?.(on);
  }

  function closePopup() {
    ctrl?.abort();
    popup?.remove();
    popup = null;
    map.getSource('own-pick')?.setData({ type: 'FeatureCollection', features: [] });
  }

  function parcelSection(state, features) {
    const box = el('section', 'own-sec');
    // Smallest footprint first: it's the most specific record at this spot.
    const recs = features
      .map((f) => ({ f, p: state.map(f.properties || {}), area: acresOf(f.geometry) }))
      .sort((a, b) => a.area - b.area);
    const first = recs[0].p;
    const owners = [...new Set(recs.map((r) => r.p.owner).filter(Boolean))];
    const n = recs.length;
    let chip = 'Parcel';
    if (n > 1) {
      const sameId = first.id && recs.every((r) => r.p.id === first.id);
      const sameShape = recs.every((r) => Math.abs(r.area - recs[0].area) <= recs[0].area * 0.01);
      chip = sameId ? `1 parcel · ${n} tax accounts` : sameShape ? `${n} units share this lot` : `${n} overlapping parcels`;
    }
    box.append(el('span', 'own-chip', chip));
    box.append(el('b', 'own-title', owners[0] || 'Owner not listed'));
    if (first.owner2 && owners.length === 1) box.append(el('div', 'own-sub', first.owner2));
    if (owners.length > 1) {
      const more = el('details', 'own-more');
      more.append(el('summary', null, `+ ${owners.length - 1} more owner${owners.length > 2 ? 's' : ''} of record`));
      const ul = el('ul');
      owners.slice(1, 40).forEach((o) => ul.append(el('li', null, o)));
      more.append(ul);
      box.append(more);
    }
    if (first.address) box.append(el('div', 'own-sub', first.address));

    const acres = Number(first.acres) || recs[0].area;
    const dl = el('dl');
    const row = (k, v) => { if (v) { dl.append(el('dt', null, k), el('dd', null, String(v))); } };
    row('Acres', acres ? fmtAcres(acres) : '');
    row('Parcel', first.id);
    row('County', first.county);
    row('Use', first.use && titleCase(first.use));
    box.append(dl);
    if (first.link && /^https?:\/\//.test(first.link)) {
      const a = el('a', 'own-link', 'County assessor record ↗');
      a.href = first.link;
      a.target = '_blank';
      a.rel = 'noopener';
      box.append(a);
    }
    box.append(el('small', 'own-src', `${state.credit}. Public record, not a survey.`));
    return box;
  }

  function publicSection(p) {
    const box = el('section', 'own-sec');
    const mgr = AGENCY_NAMES[p.Mang_Name] || p.Loc_Mang || p.Mang_Name;
    box.append(el('span', 'own-chip public', p.Mang_Type === 'PVT' ? 'Protected land' : 'Public land'));
    box.append(el('b', 'own-title', p.Unit_Nm || mgr || 'Public land'));
    if (mgr) box.append(el('div', 'own-sub', `Managed by ${mgr}`));
    const dl = el('dl');
    const row = (k, v) => { if (v) { dl.append(el('dt', null, k), el('dd', null, String(v))); } };
    row('Access', ACCESS[p.Pub_Access]);
    const own = AGENCY_NAMES[p.Own_Name] || p.Loc_Own;
    if (own && own !== mgr) row('Owner', own);
    row('Unit size', p.GIS_Acres ? `${fmtAcres(p.GIS_Acres)} acres` : '');
    box.append(dl);
    box.append(el('small', 'own-src', 'USGS Protected Areas Database (PAD-US 4.1). Check local rules before entering.'));
    return box;
  }

  async function inspect(lngLat) {
    closePopup();
    ctrl = new AbortController();
    const { signal } = ctrl;
    const body = el('div', 'own-pop-body');
    body.append(el('div', 'own-loading', 'Looking up public records…'));
    popup = new maplibregl.Popup({ className: 'own-pop', maxWidth: '300px', focusAfterOpen: false })
      .setLngLat(lngLat)
      .setDOMContent(body)
      .addTo(map);
    popup.on('close', () => {
      ctrl?.abort();
      map.getSource('own-pick')?.setData({ type: 'FeatureCollection', features: [] });
    });

    const inBox = (b) => lngLat.lng >= b[0] && lngLat.lng <= b[2] && lngLat.lat >= b[1] && lngLat.lat <= b[3];
    const states = STATES.filter((s) => inBox(s.bbox));
    const [parcels, pub] = await Promise.all([
      Promise.all(states.map((s) => queryPoint(s.url, lngLat, { signal })
        .then((fs) => ({ state: s, features: fs }))
        .catch(() => ({ state: s, features: [] })))),
      queryPoint(PADUS, lngLat, { geometry: false, signal }).catch(() => []),
    ]);
    if (signal.aborted) return;

    body.textContent = '';
    const hit = parcels.find((p) => p.features.length);
    // Largest unit first (a wilderness inside a national forest, say, lists the forest).
    pub.sort((a, b) => (b.properties.GIS_Acres || 0) - (a.properties.GIS_Acres || 0));
    const seen = new Set();
    const pubSections = [];
    for (const f of pub) {
      const key = `${f.properties.Unit_Nm}|${f.properties.Mang_Name}`;
      if (seen.has(key) || seen.size >= 2) continue;
      seen.add(key);
      pubSections.push(publicSection(f.properties));
    }
    // On government-owned land the agency is the real answer; parcel records
    // there are often leases or permits, so they come second.
    const govLand = pub.some((f) => f.properties.Category === 'Fee' && !['PVT', 'NGO', 'UNK'].includes(f.properties.Own_Type));
    const parcelBox = hit && parcelSection(hit.state, hit.features);
    if (parcelBox && !govLand) body.append(parcelBox);
    body.append(...pubSections);
    if (parcelBox && govLand) body.append(parcelBox);
    // Say each source once, at the end of its last section.
    const srcs = [...body.querySelectorAll('.own-src')];
    srcs.forEach((n, i) => { if (srcs.slice(i + 1).some((m) => m.textContent === n.textContent)) n.remove(); });
    if (hit) map.getSource('own-pick')?.setData({ type: 'FeatureCollection', features: hit.features.filter((f) => f.geometry) });
    if (!hit && !pub.length) {
      const box = el('section', 'own-sec');
      box.append(el('span', 'own-chip', 'Private land'));
      box.append(el('b', 'own-title', 'No public land here'));
      box.append(el('div', 'own-sub', states.length
        ? 'No parcel record was found at this spot.'
        : 'Free owner records aren’t available for this area. They are for Colorado, Wisconsin, North Carolina, Florida, Vermont, Montana and Massachusetts.'));
      body.append(box);
    }
  }

  map.on('click', (e) => {
    if (!on || map.getZoom() < 8) return;
    // Let clicks on markers and popups do their own thing.
    if (e.originalEvent.target.closest?.('.maplibregl-marker, .maplibregl-popup')) return;
    inspect(e.lngLat);
  });

  btn.addEventListener('click', () => setOn(!on));
  let saved = false;
  try { saved = localStorage.getItem('wpm.land') === '1'; } catch { /* ignore */ }
  if (map.isStyleLoaded()) setOn(saved);
  else map.once('style.load', () => setOn(saved));

  return { isOn: () => on };
}
