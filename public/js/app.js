const CHART_COLORS = { u1: '#f89f1b', u2: '#00b8d9' };

// Must match MIN_QUERY_LENGTH in routes/api.js — searching below the server's
// own minimum returns an empty list, which reads as "no such user".
const MIN_QUERY_LENGTH = 2;

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
  };
}

function formatDate(unixTs) {
  return new Date(unixTs * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function historyToSeries(history, field = 'rank') {
  return history.map(h => ({ x: h.time * 1000, y: h[field], contest_slug: h.contest_slug, user_score: h.score, contest_score: h.contest_score, total_time: h.total_time, solved: h.solved }));
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
  </div>`;
}

// Chart instances live here rather than on the Alpine components. Assigning one
// to component state wraps it in Alpine's reactivity Proxy, and ApexCharts keys
// its internal state by object identity, so the instance it is asked to tear
// down is no longer the one it registered.
const charts = new Map();

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
  const chart = new ApexCharts(mount, {
    ...base,
    chart: { ...base.chart, type: 'line', height },
    series,
    yaxis: { ...base.yaxis, title: { text: 'Rank (lower = better)', style: { color: base.chart.foreColor } } },
    tooltip: { ...base.tooltip, custom: rankTooltipHtml },
  });
  charts.set(selector, chart);
  chart.render();
}

async function resolveUser(query) {
  const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
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
          const res = await fetch(`/api/users/search?q=${encodeURIComponent(this.query)}`);
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
    loading: false,
    error: null,
    stats: null,
    history: [],

    init() {
      window.addEventListener('themechange', () => {
        if (this.stats) this.renderCharts();
      });
    },

    async load() {
      if (!this.search.canSubmit()) return;
      this.loading = true; this.error = null; this.stats = null; this.history = [];
      try {
        const { user_slug, data_region } = await this.search.resolve();
        const slug = encodeURIComponent(user_slug);
        const region = encodeURIComponent(data_region);
        const [sRes, hRes] = await Promise.all([
          fetch(`/api/user/${slug}/stats?region=${region}`),
          fetch(`/api/user/${slug}/history?region=${region}`)
        ]);
        if (!sRes.ok) throw new Error((await sRes.json()).error);
        this.stats = await sRes.json();
        this.history = await hRes.json();
        this.loading = false;
        await this.$nextTick();
        this.renderCharts();
      } catch (e) {
        this.error = e.message;
        this.loading = false;
      }
    },

    renderCharts() {
      drawRankChart('#rankChart', {
        height: 320,
        series: [{ name: 'Contest Rank', data: historyToSeries(this.history, 'rank'), color: CHART_COLORS.u1 }],
      });
    },

    formatDate,
    pct: (rank, total) => total ? ((rank / total) * 100).toFixed(1) + '%' : '-',
  }));

  // ── Compare View ─────────────────────────────────────────────────
  Alpine.data('compareUsers', () => ({
    activeTab: 'single',
    search1: userSearch(),
    search2: userSearch(),
    loading: false, error: null,
    data: null,

    init() {
      window.addEventListener('themechange', () => {
        if (this.data) this.renderCharts();
      });
    },

    async compare() {
      if (!this.search1.canSubmit() || !this.search2.canSubmit()) return;
      this.loading = true; this.error = null; this.data = null;
      try {
        // Sequential, so the error names the first field that is wrong rather
        // than whichever request happens to fail first.
        const user1 = await this.search1.resolve();
        const user2 = await this.search2.resolve();
        const params = new URLSearchParams({
          u1: user1.user_slug, r1: user1.data_region,
          u2: user2.user_slug, r2: user2.data_region,
        });
        const res = await fetch(`/api/compare?${params}`);
        if (!res.ok) throw new Error((await res.json()).error);
        this.data = await res.json();
        this.loading = false;
        await this.$nextTick();
        this.renderCharts();
      } catch (e) {
        this.error = e.message;
        this.loading = false;
      }
    },

    renderCharts() {
      drawRankChart('#compareRankChart', {
        height: 360,
        series: [
          { name: this.data.user1.stats.user_slug, data: historyToSeries(this.data.user1.history, 'rank'), color: CHART_COLORS.u1 },
          { name: this.data.user2.stats.user_slug, data: historyToSeries(this.data.user2.history, 'rank'), color: CHART_COLORS.u2 },
        ],
      });
    },
  }));

});
