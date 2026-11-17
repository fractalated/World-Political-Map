// Neighbor-aware colors for states, counties, cities and neighborhoods.
//
// Countries get their colors from a file built ahead of time
// (data/country-colors.json). There are far too many smaller areas for that,
// so they are colored in the browser instead, for whatever is on screen:
//
//   1. Read the areas of each visible level from the loaded map tiles.
//   2. Two areas of the same kind are neighbors if their outlines share
//      border points (Overture builds neighboring areas from the same
//      OpenStreetMap border lines).
//   3. Give each area the color slot its id hashes to, unless a neighbor
//      already has it; then the next free slot. Where possible it also avoids
//      the color of whatever is drawn underneath it: the county under a city
//      (which shows as a pale wash of its hue), or a township under a city,
//      or a neighborhood under a historic district. Those are only
//      preferences, since one big area can sit under dozens of small ones.
//
// Colors are remembered for the session, so an area keeps its color as you
// pan. Because the first choice is always the hashed slot, most areas get the
// same color every visit too, and never change color after first drawn.

import { LEVELS, PALETTE, SLOT_HASH_DIVISOR } from './style.js';

const SLOTS = PALETTE.length;
const SOURCE = { source: 'divisions', sourceLayer: 'division_area' };
const MAX_FEATURES = 12000; // skip a level if a view is absurdly dense

export const hashSlot = (id) => Math.floor(id / SLOT_HASH_DIVISOR) % SLOTS;

// Round a coordinate to ~1 m and pack it into one number for fast lookup.
const vkey = (p) => Math.round((p[0] + 180) * 1e5) * 2e7 + Math.round((p[1] + 90) * 1e5);

function polygonsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygons = (pt, polys) => polys.some((rings) => inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));

export function initAdminColors(map) {
  const slot = new Map(); // id -> color slot
  const order = new Map(); // id -> when it was colored (older wins conflicts)
  const adj = new Map(); // id -> Set of neighbor ids (must differ)
  const under = new Map(); // id -> Set of ids drawn beneath it (try to differ)
  let counter = 0;

  const neighbors = (id) => adj.get(id) || adj.set(id, new Set()).get(id);
  const link = (a, b) => {
    if (a === b) return;
    neighbors(a).add(b);
    neighbors(b).add(a);
  };
  const stack = (top, bottom) => {
    if (top === bottom) return;
    (under.get(top) || under.set(top, new Set()).get(top)).add(bottom);
  };

  function scan(level) {
    const drawOrder = (it) => level.subtypes.indexOf(it.subtype);
    const feats = map.querySourceFeatures('divisions', {
      sourceLayer: 'division_area',
      filter: ['all', ['==', ['get', 'class'], 'land'], ['match', ['get', 'subtype'], level.subtypes, true, false]],
    });
    if (!feats.length || feats.length > MAX_FEATURES) return null;

    const byVertex = new Map(); // vertex -> ids touching it
    const info = new Map(); // id -> { subtype, bbox, polys }
    for (const f of feats) {
      const id = f.id;
      if (typeof id !== 'number') continue;
      let it = info.get(id);
      if (!it) info.set(id, (it = { subtype: f.properties.subtype, bbox: [180, 90, -180, -90], polys: [] }));
      for (const rings of polygonsOf(f.geometry)) {
        it.polys.push(rings);
        for (const ring of rings) {
          for (const p of ring) {
            const k = vkey(p);
            let ids = byVertex.get(k);
            if (!ids) byVertex.set(k, (ids = new Set()));
            ids.add(id);
            if (p[0] < it.bbox[0]) it.bbox[0] = p[0];
            if (p[1] < it.bbox[1]) it.bbox[1] = p[1];
            if (p[0] > it.bbox[2]) it.bbox[2] = p[0];
            if (p[1] > it.bbox[3]) it.bbox[3] = p[1];
          }
        }
      }
    }

    // Neighbors: two or more shared border points (one alone is just a corner).
    const shared = new Map();
    for (const ids of byVertex.values()) {
      if (ids.size < 2) continue;
      const arr = [...ids];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = Math.min(arr[i], arr[j]);
          const b = Math.max(arr[i], arr[j]);
          const key = `${a}|${b}`;
          const n = (shared.get(key) || 0) + 1;
          shared.set(key, n);
          if (n !== 2) continue;
          const ia = info.get(a);
          const ib = info.get(b);
          if (ia.subtype === ib.subtype) link(a, b);
          else if (drawOrder(ia) > drawOrder(ib)) stack(a, b);
          else stack(b, a);
        }
      }
    }

    // Levels that mix subtypes can stack areas on top of each other.
    if (level.subtypes.length > 1) {
      const items = [...info.entries()];
      if (items.length < 4000) {
        for (let i = 0; i < items.length; i++) {
          const [ia, a] = items[i];
          for (let j = i + 1; j < items.length; j++) {
            const [ib, b] = items[j];
            if (a.subtype === b.subtype) continue;
            if (a.bbox[0] > b.bbox[2] || b.bbox[0] > a.bbox[2] || a.bbox[1] > b.bbox[3] || b.bbox[1] > a.bbox[3]) continue;
            const area = (x) => (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]);
            const [small, big] = area(a) < area(b) ? [a, b] : [b, a];
            const c = [(small.bbox[0] + small.bbox[2]) / 2, (small.bbox[1] + small.bbox[3]) / 2];
            if (!inPolygons(c, big.polys)) continue;
            if (drawOrder(a) > drawOrder(b)) stack(ia, ib);
            else stack(ib, ia);
          }
        }
      }
    }
    return info;
  }

  // The area of a coarser level under the middle of each area at this level.
  function parentSlots(info, coarser) {
    const out = new Map();
    for (const [id, it] of info) {
      const c = [(it.bbox[0] + it.bbox[2]) / 2, (it.bbox[1] + it.bbox[3]) / 2];
      for (const parents of coarser) {
        let hit = null;
        for (const [pid, p] of parents) {
          if (c[0] < p.bbox[0] || c[0] > p.bbox[2] || c[1] < p.bbox[1] || c[1] > p.bbox[3]) continue;
          if (inPolygons(c, p.polys)) { hit = pid; break; }
        }
        if (hit !== null) {
          out.set(id, slot.has(hit) ? slot.get(hit) : hashSlot(hit));
          break;
        }
      }
    }
    return out;
  }

  function setSlot(id, s) {
    slot.set(id, s);
    order.set(id, ++counter);
    map.setFeatureState({ ...SOURCE, id }, { c: s });
  }

  function color(ids, parent = new Map()) {
    // An area colored before we knew about one of its neighbors may clash;
    // the newer of the two gives way.
    for (const id of ids) {
      const s = slot.get(id);
      if (s === undefined) continue;
      for (const n of adj.get(id) || []) {
        if (slot.get(n) === s && order.get(n) < order.get(id)) {
          slot.delete(id);
          break;
        }
      }
    }
    const todo = ids.filter((id) => !slot.has(id));
    // Most-connected first; ties broken by id so the result is repeatable.
    todo.sort((a, b) => (adj.get(b)?.size || 0) - (adj.get(a)?.size || 0) || a - b);
    for (const id of todo) {
      const taken = new Set();
      for (const n of adj.get(id) || []) {
        // An uncolored neighbor is showing its hashed slot for now.
        taken.add(slot.has(n) ? slot.get(n) : hashSlot(n));
      }
      const pref = hashSlot(id);
      const pick = (avoid) => {
        for (let k = 0; k < SLOTS; k++) {
          const s = (pref + k) % SLOTS;
          if (!avoid.has(s)) return s;
        }
        return null;
      };
      const soft = new Set(taken);
      if (parent.has(id)) soft.add(parent.get(id));
      for (const u of under.get(id) || []) soft.add(slot.has(u) ? slot.get(u) : hashSlot(u));
      let s = pick(soft);
      if (s === null) s = pick(taken);
      if (s === null) s = pref; // every slot taken (very rare): accept a clash
      setSlot(id, s);
    }
  }

  let timer = null;
  function run() {
    timer = null;
    if (!map.getSource('divisions')) return;
    const z = map.getZoom();
    const coarser = []; // scans of the levels above, finest first
    for (const level of LEVELS.slice(1)) {
      if (z < level.start - 0.01) break;
      const info = scan(level);
      if (!info) continue;
      color([...info.keys()], parentSlots(info, coarser));
      coarser.unshift(info);
    }
  }
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 180);
  };

  map.on('moveend', schedule);
  map.on('sourcedata', (e) => {
    if (e.sourceId === 'divisions' && e.tile) schedule();
  });
  map.on('style.load', () => {
    slot.clear(); // feature-state is wiped when the style reloads
    schedule();
  });

  return { slotOf: (id) => (slot.has(id) ? slot.get(id) : hashSlot(id)) };
}
