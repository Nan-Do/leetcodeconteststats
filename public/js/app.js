// `best` is --success from the stylesheet: the one point on a line that is worth
// looking at on its own, in a colour neither user's line can be confused with.
const CHART_COLORS = { u1: '#f89f1b', u2: '#00b8d9', best: '#36b37e' };

// Must match MIN_QUERY_LENGTH in routes/api.js — searching below the server's
// own minimum returns an empty list, which reads as "no such user".
const MIN_QUERY_LENGTH = 2;

// The API lets a browser keep a reply for an hour, so a response can outlive the
// deploy that changed its shape: a page loaded minutes after one can still be
// handed the previous version's answer for a user it has already looked up. The
// URL is the cache key, so bumping this retires them. Bump it whenever an
// endpoint's response shape changes.
const API_VERSION = 2;

function apiUrl(path, params = {}) {
  return `/api/${path}?${new URLSearchParams({ ...params, v: API_VERSION })}`;
}

// Must match the rule db.js applies in SQL: a contest counts as attended when
// the user scored in it. A row with a score of 0 is a contest they registered
// for and either sat out or submitted nothing in.
const hasAttended = (contest) => contest.score > 0;

const SKIP_FILTER_KEY = 'hideSkipped';

// A stat with no contests behind it — every contest hidden, say — has nothing to
// report rather than a zero.
const dash = (value, prefix = '') => (value === null || value === undefined ? '—' : prefix + value);

const pct = (part, total) => (total ? ((part / total) * 100).toFixed(1) + '%' : '-');

function getApexBase() {
  const light = document.body.classList.contains('light');
  const bg = light ? '#ffffff' : '#1a1d27';
  const fg = light ? '#5a6080' : '#7a7f9a';
  const border = light ? '#cdd1e4' : '#2e3250';
  const legend = light ? '#1a1d27' : '#e4e6f0';
  return {
    chart: { background: bg, foreColor: fg, toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } }, animations: { enabled: true, speed: 400 } },
    grid: { borderColor: border, strokeDashArray: 4 },
    tooltip: { theme: light ? 'light' : 'dark', x: { format: 'MMM yyyy' } },
    xaxis: { type: 'datetime', labels: { style: { colors: fg } } },
    yaxis: { reversed: true, labels: { style: { colors: fg }, formatter: v => Math.round(v) } },
    legend: { labels: { colors: legend } },
    stroke: { curve: 'smooth', width: 3 },
    markers: { size: 4, hover: { size: 7 } },
    // Hiding skipped contests can empty the chart, for a user who never scored.
    noData: { text: 'No contests to show', style: { color: fg } },
  };
}

function formatDate(unixTs) {
  return new Date(unixTs * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function historyToSeries(history, field = 'rank') {
  return history.map(h => ({ x: h.time * 1000, y: h[field], contest_slug: h.contest_slug, user_score: h.score, contest_score: h.contest_score, total_time: h.total_time, solved: h.solved, skipped: !hasAttended(h) }));
}

function rankTooltipHtml({ series, seriesIndex, dataPointIndex, w }) {
  const light = document.body.classList.contains('light');
  const bg = light ? '#ffffff' : '#1a1d27';
  const border = light ? '#cdd1e4' : '#2e3250';
  const text = light ? '#1a1d27' : '#e4e6f0';
  const muted = light ? '#5a6080' : '#7a7f9a';

  const s = w.config.series[seriesIndex];
  const point = s.data[dataPointIndex];
  const rank = series[seriesIndex][dataPointIndex];
  const date = new Date(point.x).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  // Says why the point is marked out from the rest of the line, in the colour it
  // is marked in.
  const note = point.skipped ? { text: 'Skipped — no score in this contest', color: muted }
    : point.best ? { text: 'Best rank on the chart', color: CHART_COLORS.best }
      : null;

  const row = (label, value) =>
    `<div style="display:flex;justify-content:space-between;gap:16px;padding:2px 0">
       <span style="color:${muted}">${label}</span>
       <span style="color:${text};font-weight:600">${value}</span>
     </div>`;

  return `<div style="padding:8px 12px;background:${bg};border:1px solid ${border};border-radius:8px;font-size:13px;min-width:200px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
      <span style="color:${muted};font-size:11px">${date}</span>
    </div>
    ${row('Contest:', point.contest_slug || '—')}
    ${row('Rank:', `#${rank}`)}
    ${row('Solved:', `${point.solved}`)}
    ${row('Score:', `${point.user_score}/${point.contest_score}`)}
    ${row('Time:', `${point.total_time}`)}
    ${note ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${border};color:${note.color};font-size:11px">${note.text}</div>` : ''}
  </div>`;
}

// Chart instances live here rather than on the Alpine components. Assigning one
// to component state wraps it in Alpine's reactivity Proxy, and ApexCharts keys
// its internal state by object identity, so the instance it is asked to tear
// down is no longer the one it registered.
const charts = new Map();

// Clicking Load Stats repeatedly starts a request each time -- the button is
// only disabled while `loading` is true, and against a fast database that is
// over in a few milliseconds, well before the chart has finished drawing. Each
// view counts its requests so that one that is no longer the newest drops its
// results instead of rendering them over the top of a later one.
const latestRequest = { single: 0, compare: 0 };

// Replaces whatever chart is in `selector` with a new one.
function drawRankChart(selector, { series, height }) {
  const host = document.querySelector(selector);
  charts.get(selector)?.destroy();
  charts.delete(selector);

  // Every chart gets its own element, and the host is emptied before the new
  // one goes in. ApexCharts writes into whatever element it was handed, so
  // anything the outgoing chart still does lands in a node that is no longer in
  // the document rather than stacking under the replacement: a teardown that
  // could not find its own SVG (it gives up silently), a render that had not
  // finished, or the min-height it leaves on its container.
  const mount = document.createElement('div');
  host.replaceChildren(mount);
  host.style.minHeight = '';

  const base = getApexBase();

  // Two points on a line are worth picking out of it, and marking both is what
  // makes each of them mean something: a hollow grey dot for a contest that was
  // skipped -- "no result", where a filled one would read as a genuinely
  // terrible one -- and a green one for the best rank on the chart. The best is
  // taken from the points actually drawn, so a skipped contest can never claim
  // it, and a rank matched more than once is marked every time it was reached.
  const marks = [];
  series.forEach((s, seriesIndex) => {
    const best = Math.min(...s.data.filter(point => !point.skipped).map(point => point.y));
    s.data.forEach((point, dataPointIndex) => {
      if (point.skipped) {
        marks.push({ seriesIndex, dataPointIndex, size: 4, fillColor: base.chart.background, strokeColor: base.chart.foreColor });
      } else if (point.y === best) {
        // Read back by the tooltip. Set before the chart is handed the series,
        // so it is there whether or not ApexCharts copies the points.
        point.best = true;
        marks.push({ seriesIndex, dataPointIndex, size: 5, fillColor: CHART_COLORS.best, strokeColor: base.chart.background });
      }
    });
  });

  const chart = new ApexCharts(mount, {
    ...base,
    chart: { ...base.chart, type: 'line', height },
    series,
    yaxis: { ...base.yaxis, title: { text: 'Rank (lower = better)', style: { color: base.chart.foreColor } } },
    tooltip: { ...base.tooltip, custom: rankTooltipHtml },
    markers: { ...base.markers, discrete: marks },
  });
  charts.set(selector, chart);
  chart.render();
}

// The "hide skipped contests" switch. Both views own one, and it answers the two
// questions every binding downstream of it asks: which contests to draw, and
// which of the two blocks of stats the server sent to show.
function skipFilter() {
  return {
    // Hidden to begin with. A contest nobody competed in is not a result, and
    // left in it says more about where the rank axis ends than about anyone's
    // form. Only an explicit "false" -- the switch turned off on an earlier
    // visit -- brings them back.
    on: localStorage.getItem(SKIP_FILTER_KEY) !== 'false',

    // Whether skipped contests are wanted is a standing preference rather than
    // something to say again for every user looked up, so it persists like the
    // theme does. The switch has already written `on` through x-model.
    remember() {
      localStorage.setItem(SKIP_FILTER_KEY, this.on ? 'true' : 'false');
    },

    history(history) {
      return this.on ? history.filter(hasAttended) : history;
    },

    stats(stats) {
      return this.on ? stats.attended : stats.all;
    },
  };
}

async function resolveUser(query) {
  const res = await fetch(apiUrl('users/search', { q: query }));
  if (!res.ok) throw new Error(`Could not look up "${query}"`);
  const results = await res.json();
  // Case is part of the identity — several accounts can differ only in case, so
  // an exactly-cased match wins over a namesake that merely matches loosely.
  return results.find(u => u.user_slug === query)
    ?? results.find(u => u.user_slug.toLowerCase() === query.toLowerCase())
    ?? null;
}

// One username field with autocomplete. The single-user view owns one of these
// and the compare view owns two — the same nine lines used to be written out
// three times, which is how the copies drifted apart and only one of them ended
// up double-submitting on Enter.
function userSearch() {
  // Neither of these is UI state, so they stay out of the reactive object.
  let debounceTimer = null;
  let latestRequest = 0;

  return {
    query: '',
    suggestions: [],
    highlightIndex: -1,
    selected: null,

    canSubmit() {
      return this.query.length >= MIN_QUERY_LENGTH;
    },

    close() {
      this.suggestions = [];
      this.highlightIndex = -1;
    },

    onInput() {
      clearTimeout(debounceTimer);
      this.selected = null;
      this.highlightIndex = -1;
      if (this.query.length < MIN_QUERY_LENGTH) { this.suggestions = []; return; }

      debounceTimer = setTimeout(async () => {
        // Debouncing spaces requests out but doesn't order them: a slow reply
        // for "lar" can still land after a fast one for "larryny" and replace
        // the list. Only the newest request may write, and a failed one clears
        // rather than leaving stale names on screen.
        const request = ++latestRequest;
        let results = [];
        try {
          const res = await fetch(apiUrl('users/search', { q: this.query }));
          if (res.ok) results = await res.json();
        } catch { /* offline: fall through to the empty list */ }
        if (request === latestRequest) this.suggestions = results;
      }, 250);
    },

    pick(u) {
      this.query = u.user_slug;
      this.selected = u;
      this.close();
    },

    // Returns 'picked' when Enter took a suggestion, 'submit' when it should run
    // the view's action, and null otherwise. What each means is the one thing
    // the two views legitimately disagree about, so the caller decides.
    onKeydown(e) {
      if (e.key === 'ArrowDown' && this.suggestions.length) {
        e.preventDefault();
        this.highlightIndex = Math.min(this.highlightIndex + 1, this.suggestions.length - 1);
      } else if (e.key === 'ArrowUp' && this.suggestions.length) {
        e.preventDefault();
        this.highlightIndex = Math.max(this.highlightIndex - 1, -1);
      } else if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.highlightIndex >= 0) { this.pick(this.suggestions[this.highlightIndex]); return 'picked'; }
        this.close();
        return 'submit';
      }
      return null;
    },

    // Turns the typed text into a real account, remembering the answer so a
    // second submit doesn't search again.
    async resolve() {
      if (!this.selected) {
        this.selected = await resolveUser(this.query);
        if (!this.selected) throw new Error(`User "${this.query}" not found`);
      }
      return this.selected;
    },
  };
}

document.addEventListener('alpine:init', () => {

  // ── Single User View ──────────────────────────────────────────────
  Alpine.data('singleUser', () => ({
    activeTab: 'single',
    search: userSearch(),
    filter: skipFilter(),
    loading: false,
    error: null,
    stats: null,
    history: [],

    init() {
      window.addEventListener('themechange', () => {
        if (this.stats) this.renderCharts();
      });
    },

    // What the cards and the chart are showing, which the switch decides.
    get shownStats() {
      return this.stats && this.filter.stats(this.stats);
    },

    get shownHistory() {
      return this.filter.history(this.history);
    },

    // The field size has to come from the same contests the card counted:
    // looking the rank up across the whole history lets a skipped contest that
    // happens to share the number answer for the one that earned it.
    bestRankPct() {
      const contest = this.shownHistory.find(h => h.rank === this.shownStats.best_rank);
      return contest ? 'Top ' + pct(contest.rank, contest.num_participants) : '—';
    },

    filterNote() {
      const skipped = this.stats.skipped_count;
      if (!skipped) return 'No skipped contests';
      return `${skipped} of ${this.stats.all.total_contests} contests ${this.filter.on ? 'hidden' : 'skipped'}`;
    },

    async load() {
      if (!this.search.canSubmit()) return;
      const request = ++latestRequest.single;
      const current = () => request === latestRequest.single;

      this.loading = true; this.error = null; this.stats = null; this.history = [];
      try {
        const { user_slug, data_region } = await this.search.resolve();
        const path = `user/${encodeURIComponent(user_slug)}`;
        const [sRes, hRes] = await Promise.all([
          fetch(apiUrl(`${path}/stats`, { region: data_region })),
          fetch(apiUrl(`${path}/history`, { region: data_region }))
        ]);
        if (!current()) return;
        if (!sRes.ok) throw new Error((await sRes.json()).error);
        this.stats = await sRes.json();
        this.history = await hRes.json();
        this.loading = false;
        await this.$nextTick();
        // A newer click during the tick would already be drawing its own chart.
        if (!current()) return;
        this.renderCharts();
      } catch (e) {
        if (!current()) return;
        this.error = e.message;
        this.loading = false;
      }
    },

    renderCharts() {
      drawRankChart('#rankChart', {
        height: 320,
        series: [{ name: 'Contest Rank', data: historyToSeries(this.shownHistory, 'rank'), color: CHART_COLORS.u1 }],
      });
    },

    formatDate,
    pct,
    dash,
  }));

  // ── Compare View ─────────────────────────────────────────────────
  Alpine.data('compareUsers', () => ({
    activeTab: 'single',
    search1: userSearch(),
    search2: userSearch(),
    filter: skipFilter(),
    loading: false, error: null,
    data: null,

    init() {
      window.addEventListener('themechange', () => {
        if (this.data) this.renderCharts();
      });
    },

    // Both columns are addressed by number so that the two of them stay one
    // block of markup rather than two that have to be edited together.
    stats(n) {
      return this.filter.stats(this.data[`user${n}`].stats);
    },

    wins(n) {
      return (this.filter.on ? this.data.wins.attended : this.data.wins.all)[`user${n}`];
    },

    filterNote() {
      const s1 = this.data.user1.stats;
      const s2 = this.data.user2.stats;
      if (!s1.skipped_count && !s2.skipped_count) return 'No skipped contests';
      return `${this.filter.on ? 'Hidden' : 'Skipped'} — ${s1.user_slug}: ${s1.skipped_count} · ${s2.user_slug}: ${s2.skipped_count}`;
    },

    async compare() {
      if (!this.search1.canSubmit() || !this.search2.canSubmit()) return;
      const request = ++latestRequest.compare;
      const current = () => request === latestRequest.compare;

      this.loading = true; this.error = null; this.data = null;
      try {
        // Sequential, so the error names the first field that is wrong rather
        // than whichever request happens to fail first.
        const user1 = await this.search1.resolve();
        const user2 = await this.search2.resolve();
        const res = await fetch(apiUrl('compare', {
          u1: user1.user_slug, r1: user1.data_region,
          u2: user2.user_slug, r2: user2.data_region,
        }));
        if (!current()) return;
        if (!res.ok) throw new Error((await res.json()).error);
        this.data = await res.json();
        this.loading = false;
        await this.$nextTick();
        // A newer click during the tick would already be drawing its own chart.
        if (!current()) return;
        this.renderCharts();
      } catch (e) {
        if (!current()) return;
        this.error = e.message;
        this.loading = false;
      }
    },

    renderCharts() {
      drawRankChart('#compareRankChart', {
        height: 360,
        series: [
          { name: this.data.user1.stats.user_slug, data: historyToSeries(this.filter.history(this.data.user1.history), 'rank'), color: CHART_COLORS.u1 },
          { name: this.data.user2.stats.user_slug, data: historyToSeries(this.filter.history(this.data.user2.history), 'rank'), color: CHART_COLORS.u2 },
        ],
      });
    },

    dash,
  }));

});
