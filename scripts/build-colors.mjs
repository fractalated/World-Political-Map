#!/usr/bin/env node
// Builds data/country-colors.json: assigns every country / dependency in the
// latest Overture Maps "divisions" release one of N palette slots so that no
// two countries that share a land border get the same color.
//
// Run with:  npm run colors
// A GitHub Action runs this monthly so new or changed countries pick up a
// neighbor-aware color automatically. (The map itself never needs this file
// to show new boundaries; unknown countries fall back to a hashed color.)

import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { gunzipSync } from 'node:zlib';
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const PALETTE_SLOTS = 6;
const SAMPLE_ZOOM = 4; // 256 tiles; keeps small borders that drop out at z0-2
const OUT = new URL('../data/country-colors.json', import.meta.url);

async function latestDivisionsUrl() {
  const root = await (await fetch('https://stac.overturemaps.org/catalog.json')).json();
  const release = root.latest;
  const cat = await (await fetch(`https://stac.overturemaps.org/${release}/divisions/catalog.json`)).json();
  const link = cat.links.find((l) => l.rel === 'pmtiles');
  if (!link) throw new Error('No PMTiles link in divisions catalog');
  return { release, url: link.href };
}

function decode(data) {
  let buf = Buffer.from(data);
  try { buf = gunzipSync(buf); } catch { /* already raw */ }
  return new VectorTile(new Pbf(buf));
}

async function main() {
  const { release, url } = await latestDivisionsUrl();
  console.log(`Overture release ${release}\n${url}`);
  const pm = new PMTiles(url);

  const divToCountry = new Map(); // division_id -> ISO code
  const codes = new Set();
  const borders = []; // [division_id, division_id]

  const n = 2 ** SAMPLE_ZOOM;
  const jobs = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) jobs.push([x, y]);

  let done = 0;
  async function worker() {
    while (jobs.length) {
      const [x, y] = jobs.pop();
      const tile = await pm.getZxy(SAMPLE_ZOOM, x, y);
      done++;
      if (!tile) continue;
      const vt = decode(tile.data);
      const areas = vt.layers.division_area;
      if (areas) {
        for (let i = 0; i < areas.length; i++) {
          const p = areas.feature(i).properties;
          if ((p.subtype === 'country' || p.subtype === 'dependency') && p.country) {
            divToCountry.set(p.division_id, p.country);
            codes.add(p.country);
          }
        }
      }
      const bounds = vt.layers.division_boundary;
      if (bounds) {
        for (let i = 0; i < bounds.length; i++) {
          const p = bounds.feature(i).properties;
          if (p.subtype !== 'country' || p.class !== 'land' || !p.division_ids) continue;
          try {
            const ids = JSON.parse(p.division_ids);
            if (ids.length === 2) borders.push(ids);
          } catch { /* ignore */ }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  console.log(`Read ${done} tiles: ${codes.size} countries, ${borders.length} border segments`);

  const adj = new Map([...codes].map((c) => [c, new Set()]));
  for (const [a, b] of borders) {
    const ca = divToCountry.get(a);
    const cb = divToCountry.get(b);
    if (!ca || !cb || ca === cb) continue;
    adj.get(ca)?.add(cb);
    adj.get(cb)?.add(ca);
  }

  // Keep previous assignments where still valid, so colors stay stable
  // month to month and only change when a border actually forces it.
  let previous = {};
  try { previous = JSON.parse(await readFile(OUT, 'utf8')).colors || {}; } catch { /* first run */ }

  // DSatur greedy coloring, balanced across slots.
  const color = {};
  const usage = new Array(PALETTE_SLOTS).fill(0);
  const remaining = new Set(codes);
  const saturation = (c) => new Set([...adj.get(c)].map((x) => color[x]).filter((v) => v !== undefined)).size;
  while (remaining.size) {
    let best = null;
    for (const c of remaining) {
      if (!best) { best = c; continue; }
      const s = saturation(c) - saturation(best);
      if (s > 0 || (s === 0 && adj.get(c).size > adj.get(best).size) ||
          (s === 0 && adj.get(c).size === adj.get(best).size && c < best)) best = c;
    }
    const taken = new Set([...adj.get(best)].map((x) => color[x]));
    const prev = previous[best];
    let slot;
    if (prev !== undefined && prev < PALETTE_SLOTS && !taken.has(prev)) slot = prev;
    else {
      const free = [...Array(PALETTE_SLOTS).keys()].filter((k) => !taken.has(k));
      slot = free.length ? free.sort((a, b) => usage[a] - usage[b])[0] : 0;
    }
    color[best] = slot;
    usage[slot]++;
    remaining.delete(best);
  }

  const sorted = Object.fromEntries(Object.entries(color).sort(([a], [b]) => a.localeCompare(b)));
  const out = { release, slots: PALETTE_SLOTS, colors: sorted };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Wrote ${Object.keys(sorted).length} colors; slot usage ${usage.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
