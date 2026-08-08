/* ─── RailHop : algorithm.js ────────────────────────────────────── */

const COACH_CLASS = { S: 'SL', A: '2A', B: '3A', H: '1A' };
const BERTH_NAMES = { L: 'Lower', M: 'Middle', U: 'Upper', SL: 'Side Lower', SU: 'Side Upper' };

function getCoachClass(coachName) {
  return COACH_CLASS[coachName[0]] || 'SL';
}

function getBerthType(n) {
  const r = n % 8;
  if (r === 1 || r === 4) return 'L';
  if (r === 2 || r === 5) return 'M';
  if (r === 3 || r === 6) return 'U';
  if (r === 7)            return 'SL';
  return 'SU';
}

function getBerthTypeName(t) { return BERTH_NAMES[t] || t; }
function getCabin(n)          { return Math.ceil(n / 8); }

function buildIdxMap(stations) {
  const m = {};
  (stations || []).forEach(s => { m[s.code] = s.idx; });
  return m;
}

/* ── Official Indian Railways chart preparation rules ────────────── */
function getChartRules(depTime) {
  const rules = [
    {
      title  : 'Departure 5:00 AM – 2:00 PM',
      chart1 : 'Chart 1 → Previous night at 8:00 PM',
      chart2 : 'Chart 2 (Final) → 30 min before departure',
      note   : 'Online booking closes when Chart 1 is prepared',
    },
    {
      title  : 'Departure 2:00 PM – 5:00 AM',
      chart1 : 'Chart 1 → 10 hours before departure',
      chart2 : 'Chart 2 (Final) → 30 min before departure',
      note   : 'Online booking closes when Chart 1 is prepared',
    },
  ];

  let activeIdx = -1;
  if (depTime && depTime !== '--') {
    const [h, m] = depTime.split(':').map(Number);
    const mins   = h * 60 + (m || 0);
    activeIdx    = (mins >= 300 && mins < 840) ? 0 : 1;
  }
  return { rules, activeIdx };
}

/* ── Multi-hop BFS seat finding ──────────────────────────────────── */
function findAllPaths(berths, idxMap, from, to, classFilter) {
  const uf = idxMap[from];
  const ut = idxMap[to];
  if (!uf || !ut || uf >= ut) return { direct: [], hop: [] };

  /* Deduplicate and filter to journey-relevant berths */
  const seen = new Set();
  const rel  = (berths || []).filter(b => {
    const bf = idxMap[b.from];
    const bt = idxMap[b.to];
    if (!bf || !bt || bf >= ut || bt <= uf) return false;
    const cl = getCoachClass(b.coach);
    if (classFilter === 'SL' && cl !== 'SL') return false;
    if (classFilter === 'AC' && cl === 'SL') return false;
    const k = `${b.coach}-${b.berth}-${b.from}-${b.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  /* Direct: single berth covers full journey */
  const direct = rel.filter(b => idxMap[b.from] <= uf && idxMap[b.to] >= ut);

  /* BFS for multi-hop combinations */
  const results  = [];
  const pathSeen = new Set();
  const MAX_RESULTS = 150;
  const MAX_HOPS    = 8;

  let frontier = rel
    .filter(b => idxMap[b.from] <= uf && idxMap[b.to] > uf && idxMap[b.to] < ut)
    .map(b => ({ path: [b], reach: idxMap[b.to] }));

  for (let level = 2; level <= MAX_HOPS && frontier.length && results.length < MAX_RESULTS; level++) {
    const next = [];

    for (const { path, reach } of frontier) {
      if (results.length >= MAX_RESULTS) break;
      const used = new Set(path.map(b => `${b.coach}-${b.berth}`));

      rel
        .filter(b =>
          !used.has(`${b.coach}-${b.berth}`) &&
          idxMap[b.from] <= reach &&
          idxMap[b.to]   >  reach
        )
        .slice(0, 10)
        .forEach(ext => {
          const newPath = [...path, ext];
          const sig     = newPath.map(b => `${b.coach}-${b.berth}`).join('|');
          if (pathSeen.has(sig)) return;
          pathSeen.add(sig);
          if (idxMap[ext.to] >= ut) results.push(newPath);
          else if (level < MAX_HOPS) next.push({ path: newPath, reach: idxMap[ext.to] });
        });
    }

    frontier = next.slice(0, 500);
  }

  /* Sort: fewer hops first, then by coach adjacency (less walking) */
  results.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    const dist = arr => arr.slice(1).reduce((s, seg, i) =>
      s + Math.abs((parseInt(seg.coach.slice(1)) || 0) - (parseInt(arr[i].coach.slice(1)) || 0)), 0);
    return dist(a) - dist(b);
  });

  return { direct, hop: results };
}
