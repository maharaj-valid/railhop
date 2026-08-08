/* ─── RailHop : app.js ───────────────────────────────────────────
   Requires algorithm.js to be loaded first (see index.html)      */

/* ── App State ───────────────────────────────────────────────────── */
const S = {
  view         : 'search',
  trainNo      : '',
  trainData    : null,   // { trainName, stations:[{code,name,dep,arr,idx}], srcStation }
  confirmed    : false,
  dateOffset   : 0,
  from         : '',
  to           : '',
  classFilter  : 'ALL',
  berths       : [],
  composition  : null,
  results      : null,   // { direct, hop }
  loading      : false,
  trainLoading : false,
  modal        : null,   // 'from' | 'to' | null
  modalSearch  : '',
  error        : '',
  selectedStars: 5,
};

/* ── Date helpers ────────────────────────────────────────────────── */
const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return {
    day  : DAYS[d.getDay()],
    date : d.getDate(),
    mon  : MONTHS[d.getMonth()],
    iso  : d.toISOString().split('T')[0],
    full : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  };
}

/* ── API helpers ─────────────────────────────────────────────────── */
async function apiGet(url) {
  const res  = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Load train schedule ─────────────────────────────────────────── */
async function loadSchedule(trainNo) {
  const data     = await apiGet(`/api/train/${trainNo}/schedule`);
  const stations = data.stationList || [];
  if (!stations.length) throw new Error(`Train ${trainNo} has no station data.`);

  return {
    trainName  : data.trainName || `Train ${trainNo}`,
    srcStation : data.stationFrom || stations[0]?.stationCode || '',
    stations   : stations.map(s => ({
      code : s.stationCode,
      name : s.stationName,
      dep  : s.departureTime || '--',
      arr  : s.arrivalTime   || '--',
      idx  : +(s.stnSerialNumber || 0),
    })).filter(s => s.code && s.idx),
  };
}

/* ── Load chart data + vacant berths ─────────────────────────────── */
async function loadChart() {
  const date = getDate(S.dateOffset).iso;
  const src  = S.trainData.srcStation;

  S.composition = await apiPost('/api/chart/composition', {
    trainNo: S.trainNo, jDate: date, boardingStation: S.from,
  });

  const classes =
    S.classFilter === 'SL' ? ['SL'] :
    S.classFilter === 'AC' ? ['2A', '3A', '1A'] :
    ['SL', '2A', '3A', '1A'];

  let allBerths = [];
  for (const cls of classes) {
    try {
      const vd = await apiPost('/api/chart/vacant', {
        trainNo: S.trainNo, boardingStation: S.from,
        remoteStation: src, trainSourceStation: src,
        jDate: date, cls,
      });
      if (vd.vbd?.length) {
        allBerths = allBerths.concat(
          vd.vbd.map(b => ({ coach: b.coachName, berth: b.berthNumber, from: b.from, to: b.to }))
        );
      }
    } catch (e) { console.warn(`Skipping class ${cls}:`, e.message); }
  }

  S.berths  = allBerths;
  S.results = findAllPaths(allBerths, buildIdxMap(S.trainData.stations), S.from, S.to, S.classFilter);
}

/* ── Reviews (localStorage) ──────────────────────────────────────── */
function getReviews() {
  try { return JSON.parse(localStorage.getItem('rh_reviews') || '[]'); } catch { return []; }
}
function saveReview(r) {
  const all = getReviews();
  all.unshift({ ...r, date: new Date().toLocaleDateString('en-IN') });
  localStorage.setItem('rh_reviews', JSON.stringify(all.slice(0, 30)));
}

/* ══════════════════════════════════════════════════════════════════
   RENDER ENGINE
══════════════════════════════════════════════════════════════════ */
function render() {
  /* Preserve cursor position in train input */
  const prevInp  = document.getElementById('tInp');
  const wasFocus = prevInp && document.activeElement === prevInp;
  const cur      = wasFocus ? prevInp.selectionStart : null;

  document.getElementById('root').innerHTML =
    S.view === 'search' ? renderSearch() : renderResults();

  /* Show/hide landing + footer */
  const ld = document.getElementById('landing');
  const ft = document.querySelector('footer');
  if (ld) ld.style.display = S.view === 'search' ? '' : 'none';
  if (ft) ft.style.display = S.view === 'search' ? '' : 'none';

  attachEvents();

  /* Restore cursor */
  if (wasFocus && cur !== null) {
    const ni = document.getElementById('tInp');
    if (ni) { ni.focus(); try { ni.setSelectionRange(cur, cur); } catch (_) {} }
  }
  /* Focus modal search — only when modal is open, no scroll */
  if (S.modal) {
    const ms = document.getElementById('msInp');
    if (ms) ms.focus({ preventScroll: true });
  }

  renderReviewsList();
}

/* ── SEARCH PAGE ─────────────────────────────────────────────────── */
function renderSearch() {
  const [dm1, d0, d1] = [getDate(-1), getDate(0), getDate(1)];
  const fromSt  = S.trainData?.stations?.find(s => s.code === S.from);
  const toSt    = S.trainData?.stations?.find(s => s.code === S.to);
  const depTime = S.trainData?.stations?.[0]?.dep || '';
  const cr      = getChartRules(depTime);
  const hasAll  = S.confirmed && S.from && S.to;

  return `
<div class="hero">
  <div class="hero-grid">

    <!-- LEFT: Chart Rules (desktop) -->
    <aside class="chart-panel">
      <div class="cp-heading">🕐 Chart Preparation Rules</div>
      <p class="cp-intro">Official Indian Railways chart schedule:</p>
      ${cr.rules.map((r, i) => `
      <div class="cp-rule ${cr.activeIdx === i ? 'cp-active' : ''}">
        ${cr.activeIdx === i ? '<div class="cp-current-badge">Your train</div>' : ''}
        <div class="cp-rule-title">${r.title}</div>
        <div class="cp-rule-line">📋 ${r.chart1}</div>
        <div class="cp-rule-line">📋 ${r.chart2}</div>
        <div class="cp-rule-note">ℹ️ ${r.note}</div>
      </div>`).join('')}
      <div class="cp-tip">💡 Refresh every 2–5 min — cancelled berths appear instantly</div>
    </aside>

    <!-- CENTER: Search -->
    <div class="hero-center">
      <div class="hero-pills">
        <span class="pill">🚃 All Trains</span>
        <span class="pill">🪑 Berth Level</span>
        <span class="pill">🔀 Smart Paths</span>
      </div>
      <h1 class="hero-h1">Check <em>IRCTC Chart</em><br>Vacancy Online</h1>
      <p class="hero-sub">Find vacant berths after chart preparation — even when Tatkal is closed.</p>

      <div class="scard">

        <!-- Train Number -->
        <div class="field">
          <label class="flabel">🚂 Train Number</label>
          <div class="tinput-wrap">
            <input id="tInp" class="train-inp"
              value="${S.trainNo}"
              placeholder="e.g. 00000"
              maxlength="5" autocomplete="off" inputmode="numeric">
            ${S.trainLoading ? `<div class="train-loading"><span class="spin-sm"></span> Fetching route…</div>` : ''}
            ${S.trainData && !S.confirmed ? `
            <div class="tsugg">
              <div class="tsugg-row" id="suggRow">
                <span>
                  <span class="ts-no">${S.trainNo}</span>
                  <span class="ts-name">${S.trainData.trainName}</span>
                </span>
                <span class="ts-route">
                  ${S.trainData.stations[0]?.code} → ${S.trainData.stations[S.trainData.stations.length - 1]?.code}
                </span>
              </div>
            </div>` : ''}
          </div>
          ${S.confirmed && S.trainData ? `
          <div class="train-confirm">
            <span class="confirm-dot"></span>
            <span class="confirm-name">${S.trainData.trainName}</span>
            <span class="confirm-route">
              ${S.trainData.stations[0]?.code} → ${S.trainData.stations[S.trainData.stations.length - 1]?.code}
            </span>
          </div>` : ''}
        </div>

        <!-- Date -->
        <div class="field">
          <label class="flabel">📅 Journey Date</label>
          <div class="date-pills">
            ${[[-1, dm1, 'YESTERDAY'], [0, d0, 'TODAY'], [1, d1, 'TOMORROW']].map(([o, d, lbl]) => `
            <div class="dpill${S.dateOffset === o ? ' on' : ''}" data-a="doff" data-v="${o}">
              <div class="dp-day">${d.day}</div>
              <div class="dp-dt">${d.date} ${d.mon}</div>
              <div class="dp-lbl">${lbl}</div>
            </div>`).join('')}
          </div>
        </div>

        <!-- Stations -->
        <div class="field">
          <label class="flabel">📍 Stations</label>
          <div class="stn-box">
            <div class="stn-row" id="fromRow"
              ${!S.confirmed ? 'style="pointer-events:none;opacity:.45"' : ''}>
              <div class="stn-dot f"></div>
              <div class="stn-text">
                <div class="stn-sublabel">From — Boarding Station</div>
                <div class="stn-val ${!S.from ? 'ph' : ''}">${
                  !S.confirmed ? 'Enter train number first'
                  : S.from ? `${S.from} — ${fromSt?.name || S.from}`
                  : 'Select boarding station'
                }</div>
              </div>
              <span class="chev">▾</span>
            </div>
            <div class="stn-divider"></div>
            <div class="stn-row" id="toRow"
              ${(!S.confirmed || !S.from) ? 'style="pointer-events:none;opacity:.45"' : ''}>
              <div class="stn-dot t"></div>
              <div class="stn-text">
                <div class="stn-sublabel">To — Destination Station</div>
                <div class="stn-val ${!S.to ? 'ph' : ''}">${
                  !S.confirmed ? 'Enter train number first'
                  : !S.from    ? 'Select boarding station first'
                  : S.to ? `${S.to} — ${toSt?.name || S.to}`
                  : 'Select destination station'
                }</div>
              </div>
              <span class="chev">▾</span>
            </div>
          </div>
        </div>

        <!-- Check button -->
        <button id="checkBtn" class="check-btn" ${(!hasAll || S.loading) ? 'disabled' : ''}>
          ${S.loading
            ? `<span class="spin"></span> Checking Vacancy…`
            : '🔍 Check Vacancy'}
        </button>

        <!-- Chart rules (mobile — below button) -->
        <div class="chart-panel-mobile">
          <div class="cp-heading">🕐 Chart Preparation Rules</div>
          ${cr.rules.map((r, i) => `
          <div class="cp-rule ${cr.activeIdx === i ? 'cp-active' : ''}">
            <div class="cp-rule-title">${r.title}</div>
            <div class="cp-rule-line">${r.chart1}</div>
            <div class="cp-rule-line">${r.chart2}</div>
          </div>`).join('')}
        </div>

        ${S.error ? `<div class="err-box">⚠️ ${S.error}</div>` : ''}
      </div>

      <div class="ad-hero">📢 Advertisement — Google AdSense</div>
    </div>

    <div></div>
  </div>
</div>
${S.modal ? renderModal() : ''}`;
}

/* ── STATION MODAL ───────────────────────────────────────────────── */
function renderModal() {
  return `
  <div class="modal-overlay" id="mOv">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">Select ${S.modal === 'from' ? 'Boarding' : 'Destination'} Station</span>
        <button class="modal-x" id="mClose">✕</button>
      </div>
      <div class="modal-search">
        <input id="msInp" value="${S.modalSearch}"
          placeholder="Search station name or code…" autocomplete="off">
      </div>
      <div id="modal-list" class="modal-list">${renderModalItems()}</div>
    </div>
  </div>`;
}

function renderModalItems() {
  const isFrom  = S.modal === 'from';
  const idxMap  = buildIdxMap(S.trainData?.stations || []);
  const fromIdx = idxMap[S.from] || 0;
  const q       = S.modalSearch.toLowerCase();

  const list = (S.trainData?.stations || [])
    .filter(s => isFrom ? true : s.idx > fromIdx)
    .filter(s => !q || s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));

  if (!list.length) return `<div class="modal-empty">No stations found</div>`;
  return list.map(s => `
    <div class="mitem" data-a="selstn" data-code="${s.code}" data-type="${isFrom ? 'from' : 'to'}">
      <span class="mi-code">${s.code}</span>
      <span class="mi-name">${s.name}</span>
      <span class="mi-stop">#${s.idx}</span>
    </div>`).join('');
}

/* Partial update — no full render, cursor stays put */
function updateModalList() {
  const el = document.getElementById('modal-list');
  if (!el) return;
  el.innerHTML = renderModalItems();
  bindModalItems();
}

function bindModalItems() {
  document.querySelectorAll('[data-a="selstn"]').forEach(el =>
    el.addEventListener('click', e =>
      selectStation(e.currentTarget.dataset.code, e.currentTarget.dataset.type)
    )
  );
}

function selectStation(code, type) {
  const idxMap = buildIdxMap(S.trainData?.stations || []);
  if (type === 'from') {
    S.from = code;
    if (S.to && idxMap[S.to] <= idxMap[code]) S.to = '';
  } else {
    S.to = code;
  }
  S.modal = null; S.modalSearch = '';
  render();
}

function closeModal() { S.modal = null; S.modalSearch = ''; render(); }

/* ── RESULTS PAGE ────────────────────────────────────────────────── */
function renderResults() {
  const { direct, hop } = S.results || { direct: [], hop: [] };
  const total    = direct.length + hop.length;
  const comp     = S.composition;
  const ready    = !!comp?.chartOneDate;
  const fromName = S.trainData.stations.find(s => s.code === S.from)?.name || S.from;
  const toName   = S.trainData.stations.find(s => s.code === S.to)?.name   || S.to;

  return `
<div class="rpage">
  <div class="rhead">
    <div class="rhead-row">
      <button class="r-back" id="rBack">←</button>
      <div class="r-tinfo">
        <div class="r-tname">${S.trainNo} — ${S.trainData.trainName}</div>
        <div class="r-troute">${fromName} → ${toName}</div>
      </div>
      <div class="r-cnt">
        <div class="r-cnt-n">${total}</div>
        <div class="r-cnt-l">Paths</div>
      </div>
      <button class="r-share" id="rShare" title="Share">📤</button>
    </div>
    <div class="rhead-bottom">
      <div class="cfilters">
        ${[['ALL', 'All Classes'], ['SL', 'Sleeper'], ['AC', 'AC Only']].map(([v, l]) =>
          `<button class="cfpill${S.classFilter === v ? ' on' : ''}" data-a="cf" data-v="${v}">${l}</button>`
        ).join('')}
      </div>
      <button class="r-refresh" id="rRefresh">🔄 Refresh</button>
    </div>
  </div>

  <div class="rbody">
    <div class="ad-r">📢 Advertisement — Google AdSense</div>

    <!-- Date + Chart status -->
    <div class="date-status-row">
      <div class="date-chip">📅 Vacancies for: ${getDate(S.dateOffset).full}</div>
      <div class="cs-bar ${ready ? '' : 'cs-warn'}">
        <span class="cs-icon">${ready ? '✅' : '⏳'}</span>
        <div>
          <div class="cs-title">${ready ? 'Chart Prepared' : 'Chart Not Ready Yet'}</div>
          <div class="cs-sub">${ready
            ? `Chart 1: ${comp.chartOneDate}${comp.chartTwoDate ? ` · Chart 2: ${comp.chartTwoDate}` : ''} · Final: 30 min before departure`
            : getChartRules(S.trainData.stations[0]?.dep).rules[getChartRules(S.trainData.stations[0]?.dep).activeIdx > -1 ? getChartRules(S.trainData.stations[0]?.dep).activeIdx : 0]?.chart1 || 'Chart not prepared yet — check back later.'
          }</div>
        </div>
      </div>
    </div>

    <div class="ad-r">📢 Advertisement</div>

    ${renderCards(direct, hop)}

    <div class="warn-box">⚠️ Availability changes every few minutes. Book quickly on IRCTC. RailHop only shows data — we do not book tickets.</div>
    <div class="ad-r" style="margin-top:10px">📢 Advertisement</div>
  </div>
</div>`;
}

function renderCards(direct, hop) {
  if (!direct.length && !hop.length) return `
    <div class="empty-state">
      <div class="es-icon">😔</div>
      <div class="es-t">No seats found</div>
      <div class="es-s">Try a different class filter, or refresh in a few minutes — cancellations appear in real-time.</div>
    </div>`;

  let html = '', n = 1;

  if (direct.length) {
    html += `<div class="results-section-label">⭐ Direct Seats — Full journey in one berth</div>`;
    direct.slice(0, 5).forEach(b => { html += renderPathCard([b], n++, true); });
    html += `<div class="ad-r">📢 Advertisement</div>`;
  }

  if (hop.length) {
    html += `<div class="results-section-label">🔀 Seat Hopping Paths — Switch berths mid-journey</div>`;
    hop.forEach((segs, i) => {
      if (i > 0 && i % 4 === 0) html += `<div class="ad-r">📢 Advertisement</div>`;
      html += renderPathCard(segs, n++, false);
    });
  }

  return html;
}

/* ── GapSeat-style path card ─────────────────────────────────────── */
function renderPathCard(segs, num, isDirect) {
  const stepsHTML = segs.map((seg, i) => {
    const isLast = i === segs.length - 1;
    const t      = getBerthType(seg.berth);
    const toName = S.trainData.stations.find(s => s.code === seg.to)?.name || seg.to;
    const cab    = getCabin(seg.berth);
    const cl     = getCoachClass(seg.coach);

    /* FIX: User boards at S.from (hop 1) or previous hop's destination (hop 2+).
       seg.from = where berth became physically vacant ≠ where user actually boards. */
    const boardAt = i === 0 ? S.from : segs[i - 1].to;

    return `
    <div class="path-step">
      <div class="step-spine">
        <div class="step-circle${isLast ? ' step-final' : ''}">${isLast ? '🏁' : i + 1}</div>
        ${!isLast ? '<div class="step-line"></div>' : ''}
      </div>
      <div class="step-body">
        <div class="step-route">
          <span class="stn-chip">${boardAt}</span>
          <span class="step-arrow">→</span>
          <span class="stn-chip${isLast ? ' stn-dest' : ''}">${seg.to}</span>
        </div>
        <div class="seat-box">
          <div class="berth-badge bt-${t}">${t}</div>
          <div class="seat-info">
            <span class="seat-num">${seg.coach} · Berth ${seg.berth}</span>
            <span class="seat-detail">Coach ${seg.coach} · Cabin ${cab} · ${getBerthTypeName(t)} · ${cl}</span>
          </div>
          <span class="berth-icon">🪑</span>
        </div>
        ${isLast
          ? `<div class="dest-chip">✅ Destination reached!</div>`
          : `<div class="switch-chip">⇄ Switch seat at ${seg.to} · ${toName}</div>`}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="path-card">
    <div class="path-card-head">
      <div class="path-num${isDirect ? ' path-direct' : ''}">${num}</div>
      <div class="path-title-wrap">
        <div class="path-title">${isDirect ? 'Direct Journey' : 'Seat Hopping Path'}</div>
        <div class="path-sub">${isDirect
          ? 'One seat for entire journey'
          : `${segs.length} seat${segs.length > 1 ? 's' : ''} to complete journey`}</div>
      </div>
      ${isDirect
        ? `<span class="best-tag">✓ Best</span>`
        : `<span class="hops-tag">⇄ ${segs.length} Hop${segs.length > 1 ? 's' : ''}</span>`}
    </div>
    <div class="path-steps">${stepsHTML}</div>
    <div class="book-wrap">
      <a class="book-btn" href="https://www.irctc.co.in/nget/train-search" target="_blank" rel="noopener">
        Book on IRCTC ↗
      </a>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   EVENTS
══════════════════════════════════════════════════════════════════ */
let trainTimer = null;

function attachEvents() {
  /* Train number — auto-search after 400ms debounce */
  const ti = document.getElementById('tInp');
  if (ti) {
    ti.addEventListener('input', e => {
      const val   = e.target.value.trim();
      S.trainNo   = val;
      S.confirmed = false;
      S.trainData = null;
      S.from      = '';
      S.to        = '';
      S.error     = '';
      clearTimeout(trainTimer);

      if (/^\d{4,5}$/.test(val)) {
        trainTimer = setTimeout(async () => {
          S.trainLoading = true; render();
          try {
            S.trainData = await loadSchedule(val);
            S.error     = '';
          } catch (err) {
            S.error     = err.message;
            S.trainData = null;
          }
          S.trainLoading = false; render();
        }, 400);
      } else {
        render();
      }
    });
  }

  /* Suggestion click — confirm train */
  document.getElementById('suggRow')?.addEventListener('click', () => {
    S.confirmed = true; render();
  });

  /* Date pills */
  document.querySelectorAll('[data-a="doff"]').forEach(el =>
    el.addEventListener('click', e => { S.dateOffset = +e.currentTarget.dataset.v; render(); })
  );

  /* Station rows */
  document.getElementById('fromRow')?.addEventListener('click', () => {
    if (!S.confirmed) return;
    S.modal = 'from'; S.modalSearch = ''; render();
  });
  document.getElementById('toRow')?.addEventListener('click', () => {
    if (!S.confirmed || !S.from) return;
    S.modal = 'to'; S.modalSearch = ''; render();
  });

  /* Modal close */
  document.getElementById('mClose')?.addEventListener('click', closeModal);
  document.getElementById('mOv')?.addEventListener('click', e => {
    if (e.target.id === 'mOv') closeModal();
  });

  /* Modal search — PARTIAL update only, cursor stays put */
  const msInp = document.getElementById('msInp');
  if (msInp) {
    msInp.addEventListener('input', e => {
      S.modalSearch = e.target.value;
      updateModalList();
    });
  }
  bindModalItems();

  /* Class filter */
  document.querySelectorAll('[data-a="cf"]').forEach(el =>
    el.addEventListener('click', e => {
      S.classFilter = e.currentTarget.dataset.v;
      if (S.berths.length) {
        S.results = findAllPaths(
          S.berths, buildIdxMap(S.trainData.stations), S.from, S.to, S.classFilter
        );
      }
      render();
    })
  );

  /* Check Vacancy */
  document.getElementById('checkBtn')?.addEventListener('click', doCheck);
  document.getElementById('rRefresh')?.addEventListener('click', doCheck);
  document.getElementById('rBack')?.addEventListener('click', () => { S.view = 'search'; render(); });
  document.getElementById('rShare')?.addEventListener('click', doShare);

  /* Star rating */
  document.querySelectorAll('.star-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      S.selectedStars = +e.currentTarget.dataset.v;
      document.querySelectorAll('.star-btn').forEach(b =>
        b.classList.toggle('active', +b.dataset.v <= S.selectedStars)
      );
    })
  );

  /* Review form */
  document.getElementById('reviewForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('rvName')?.value.trim();
    const text = document.getElementById('rvText')?.value.trim();
    if (!text) return;
    saveReview({ name: name || 'Anonymous', text, stars: S.selectedStars });
    e.target.reset();
    S.selectedStars = 5;
    document.querySelectorAll('.star-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.v <= 5)
    );
    renderReviewsList();
  });
}

async function doCheck() {
  if (!S.confirmed || !S.from || !S.to || S.loading) return;
  S.loading = true; S.error = ''; render();
  try {
    await loadChart();
    S.view = 'results';
  } catch (err) {
    S.error = err.message;
  }
  S.loading = false; render();
}

function doShare() {
  const { direct, hop } = S.results || { direct: [], hop: [] };
  const fn  = S.trainData?.stations?.find(s => s.code === S.from)?.name || S.from;
  const tn  = S.trainData?.stations?.find(s => s.code === S.to)?.name   || S.to;
  const txt = `🚆 RailHop — Chart Vacancy\n${S.trainNo} ${S.trainData?.trainName}\n${fn} → ${tn} | ${getDate(S.dateOffset).full}\n✓ ${direct.length} Direct · ⇄ ${hop.length} Hop paths\n\nrailhop.in`;
  if (navigator.share) navigator.share({ text: txt });
  else navigator.clipboard?.writeText(txt).then(() => alert('Copied to clipboard!'));
}

function renderReviewsList() {
  const el = document.getElementById('reviews-list');
  if (!el) return;
  const reviews = getReviews();
  if (!reviews.length) {
    el.innerHTML = `<div class="rv-empty">Be the first to share your experience!</div>`;
    return;
  }
  el.innerHTML = reviews.map(r => `
    <div class="rv-card">
      <div class="rv-card-top">
        <span class="rv-name">${r.name}</span>
        <span class="rv-stars">${'★'.repeat(r.stars || 5)}${'☆'.repeat(5 - (r.stars || 5))}</span>
        <span class="rv-date">${r.date || ''}</span>
      </div>
      <p class="rv-text">${r.text}</p>
    </div>`).join('');
}

/* Boot */
render();
