// Recognizes locations typed as coordinates rather than names.
//
// Understands, among others:
//   39.3722, -104.8561          39.3722 -104.8561        -104.8561, 39.3722 (swapped)
//   39°22'20"N 104°51'22"W      N 39 22.33 W 104 51.37   39 22 20 N, 104 51 22 W
//   39.3722N 104.8561W          lat 39.37 lon -104.86    39 22 20 -104 51 22
//   geo:39.37,-104.86           Google / Apple / OSM map links, this map's own #zoom/lat/lon
//   Plus Codes: 85FPHXGG+2W  (full)   HXGG+2W Castle Rock  (short + nearby place)

const OLC_ALPHABET = '23456789CFGHJMPQRVWX';

const valid = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

function result(lat, lon, zoom) {
  if (!valid(lat, lon)) return null;
  return { lat, lon, zoom: zoom ?? null };
}

// ---------------------------------------------------------------- links/URIs
function parseLink(s) {
  let m;
  // This map's own hash (#zoom/lat/lon) and OpenStreetMap (#map=zoom/lat/lon)
  if ((m = s.match(/(?:map=|#)(\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/))) {
    return result(+m[2], +m[3], +m[1]);
  }
  // Google Maps: /@lat,lon,zoomz
  if ((m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:,(\d{1,2}(?:\.\d+)?)z)?/))) {
    return result(+m[1], +m[2], m[3] ? +m[3] : null);
  }
  // Google !3d lat !4d lon
  if ((m = s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/))) return result(+m[1], +m[2]);
  // ?q=lat,lon  ?ll=  ?query=  ?sll=  ?daddr=  (Google, Apple, Bing use these)
  if ((m = s.match(/[?&](?:q|ll|sll|query|daddr|center|cp)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C|~|\s|\+)+(-?\d{1,3}(?:\.\d+)?)/i))) {
    return result(+m[1], +m[2]);
  }
  // geo: URI
  if ((m = s.match(/^geo:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i))) return result(+m[1], +m[2]);
  return null;
}

// ---------------------------------------------------------------- lat/lon text
function parseLatLon(raw) {
  let s = raw
    .toUpperCase()
    .replace(/\b(LATITUDE|LONGITUDE|LAT|LONG|LON|LNG|DEGREES|DEGREE|DEG|MINUTES|MIN|SECONDS|SEC)\b/g, ' ')
    .replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S').replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W')
    .replace(/[°º˚ºd′’'‘`´″”"“:=()[\]]/gi, ' ')
    .replace(/[−–—]/g, '-');

  // European decimal commas: "39,37 -104,86" or "39,37; -104,86"
  if (/^\s*[-+]?\d+,\d+\s*[;\s]\s*[-+]?\d+,\d+\s*$/.test(s)) s = s.replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/[,;/]/g, ' ');

  // Anything other than numbers, signs, hemisphere letters and spaces => not coordinates.
  if (/[^0-9.+\-NSEW\s]/.test(s)) return null;
  // Letters must be standalone hemisphere markers or glued to a number (39N, N39).
  const tokens = s.match(/[NSEW]|[-+]?\d+(?:\.\d+)?/g);
  if (!tokens || tokens.filter((t) => /\d/.test(t)).length < 2) return null;
  if (s.replace(/[NSEW]/g, '').match(/[A-Z]/)) return null;

  const letters = tokens.filter((t) => /^[NSEW]$/.test(t));
  const groups = [];

  if (letters.length) {
    if (letters.length > 2) return null;
    const leading = /^[NSEW]$/.test(tokens[0]);
    let cur = { nums: [], hemi: null };
    for (const t of tokens) {
      if (/^[NSEW]$/.test(t)) {
        if (leading) {
          if (cur.nums.length || cur.hemi) groups.push(cur);
          cur = { nums: [], hemi: t };
        } else {
          cur.hemi = t;
          groups.push(cur);
          cur = { nums: [], hemi: null };
        }
      } else cur.nums.push(t);
    }
    if (cur.nums.length || cur.hemi) groups.push(cur);
    // One hemisphere letter only: e.g. "39.37 N 104.86" — the other has none.
    if (groups.length === 1 && !leading) return null;
  } else {
    const nums = tokens;
    const per = nums.length / 2;
    if (![1, 2, 3].includes(per)) return null;
    groups.push({ nums: nums.slice(0, per), hemi: null }, { nums: nums.slice(per), hemi: null });
  }

  if (groups.length !== 2) return null;

  const values = [];
  for (const g of groups) {
    if (g.nums.length < 1 || g.nums.length > 3) return null;
    const [d, m = '0', sec = '0'] = g.nums;
    const deg = parseFloat(d);
    const min = parseFloat(m);
    const secs = parseFloat(sec);
    if (g.nums.length > 1 && (!Number.isInteger(Math.abs(deg)) && g.nums.length > 1)) return null;
    if (min < 0 || min >= 60 || secs < 0 || secs >= 60) return null;
    if (/^-/.test(m) || /^-/.test(sec)) return null;
    let v = Math.abs(deg) + min / 60 + secs / 3600;
    let neg = deg < 0 || /^-/.test(d);
    if (g.hemi === 'S' || g.hemi === 'W') neg = true;
    if (neg) v = -v;
    values.push({ v, hemi: g.hemi });
  }

  let [a, b] = values;
  // Put latitude first if hemispheres say otherwise.
  if ((a.hemi === 'E' || a.hemi === 'W') || (b.hemi === 'N' || b.hemi === 'S')) [a, b] = [b, a];
  if ((a.hemi && 'EW'.includes(a.hemi)) || (b.hemi && 'NS'.includes(b.hemi))) return null;

  let lat = a.v;
  let lon = b.v;
  // No hemisphere letters and the first number can't be a latitude: assume lon, lat.
  if (!a.hemi && !b.hemi && Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
  return result(lat, lon);
}

// ---------------------------------------------------------------- Plus Codes
function olcDecode(code) {
  const clean = code.toUpperCase().replace('+', '').replace(/0+$/, '');
  let lat = -90, lon = -180;
  let latRes = 400, lonRes = 400;
  const pairs = Math.min(clean.length, 10);
  for (let i = 0; i < pairs; i += 2) {
    latRes /= 20; lonRes /= 20;
    lat += OLC_ALPHABET.indexOf(clean[i]) * latRes;
    lon += OLC_ALPHABET.indexOf(clean[i + 1] ?? '2') * lonRes;
  }
  for (let i = 10; i < clean.length; i++) {
    const v = OLC_ALPHABET.indexOf(clean[i]);
    latRes /= 5; lonRes /= 4;
    lat += Math.floor(v / 4) * latRes;
    lon += (v % 4) * lonRes;
  }
  return { lat: lat + latRes / 2, lon: lon + lonRes / 2, latRes, lonRes };
}

function olcEncodePairs(lat, lon, length) {
  let la = Math.min(Math.max(lat, -90), 90 - 1e-10) + 90;
  let lo = ((((lon + 180) % 360) + 360) % 360);
  let code = '';
  let res = 20;
  for (let i = 0; i < length; i += 2) {
    const dl = Math.floor(la / res);
    const dn = Math.floor(lo / res);
    la -= dl * res; lo -= dn * res;
    code += OLC_ALPHABET[dl] + OLC_ALPHABET[dn];
    res /= 20;
  }
  return code.slice(0, length);
}

const FULL_OLC = /^[23456789CFGHJMPQRV][23456789CFGHJMPQRVWX]{7}\+[23456789CFGHJMPQRVWX]{0,3}$/i;
const SHORT_OLC = /^([23456789CFGHJMPQRVWX]{4,6}\+[23456789CFGHJMPQRVWX]{2,3})(?:[\s,]+(.+))?$/i;

export function parsePlusCode(s) {
  const t = s.trim();
  if (FULL_OLC.test(t)) {
    const d = olcDecode(t);
    return { full: result(d.lat, d.lon, 17) };
  }
  const m = t.match(SHORT_OLC);
  if (m) return { short: m[1].toUpperCase(), locality: (m[2] || '').trim() };
  return null;
}

// Recover a short code (e.g. "HXGG+2W") near a reference point.
export function recoverPlusCode(short, refLat, refLon) {
  const sep = short.indexOf('+');
  const missing = 8 - sep;
  const code = olcEncodePairs(refLat, refLon, missing) + short;
  const area = olcDecode(code);
  const res = 20 / Math.pow(20, missing / 2 - 1);
  const half = res / 2;
  let { lat, lon } = area;
  if (refLat + half < lat && lat - res >= -90) lat -= res;
  else if (refLat - half > lat && lat + res <= 90) lat += res;
  if (refLon + half < lon) lon -= res;
  else if (refLon - half > lon) lon += res;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return result(lat, lon, 17);
}

// ---------------------------------------------------------------- entry point
export function parseCoordinates(input) {
  const s = input.trim();
  if (!s) return null;
  return parseLink(s) || parseLatLon(s);
}

export function formatLatLon(lat, lon) {
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')}, ${f(lon, 'E', 'W')}`;
}
