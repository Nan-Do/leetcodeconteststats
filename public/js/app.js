const CHART_COLORS = { u1: '#f89f1b', u2: '#00b8d9' };

function getApexBase() {
  const light = document.body.classList.contains('light');
  const bg      = light ? '#ffffff' : '#1a1d27';
  const fg      = light ? '#5a6080' : '#7a7f9a';
  const border  = light ? '#cdd1e4' : '#2e3250';
  const legend  = light ? '#1a1d27' : '#e4e6f0';
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
  return history.map(h => ({ x: h.time * 1000, y: h[field], contest_slug: h.contest_slug }));
}

function rankTooltipHtml({ series, seriesIndex, dataPointIndex, w }) {
  const light  = document.body.classList.contains('light');
  const bg     = light ? '#ffffff' : '#1a1d27';
  const border = light ? '#cdd1e4' : '#2e3250';
  const text   = light ? '#1a1d27' : '#e4e6f0';
  const muted  = light ? '#5a6080' : '#7a7f9a';

  const s     = w.config.series[seriesIndex];
  const point = s.data[dataPointIndex];
  const rank  = series[seriesIndex][dataPointIndex];
  const date  = new Date(point.x).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

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
    ${row('Contest Rank:', `#${rank}`)}
    ${row('Contest:', point.contest_slug || '—')}
  </div>`;
}

async function resolveUser(query) {
  const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
  const results = await res.json();
  return results.find(u => u.username.toLowerCase() === query.toLowerCase()) || null;
}

document.addEventListener('alpine:init', () => {

  // ── Single User View ──────────────────────────────────────────────
  Alpine.data('singleUser', () => ({
    activeTab: 'single',
    query: '',
    suggestions: [],
    selectedUser: null,
    loading: false,
    error: null,
    stats: null,
    history: [],
    chart: null,
    globalChart: null,
    debounceTimer: null,

    init() {
      window.addEventListener('themechange', () => {
        if (this.stats) this.renderCharts();
      });
    },

    async onInput() {
      this.selectedUser = null;
      clearTimeout(this.debounceTimer);
      if (this.query.length < 2) { this.suggestions = []; return; }
      this.debounceTimer = setTimeout(async () => {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(this.query)}`);
        this.suggestions = await res.json();
      }, 250);
    },

    selectSuggestion(u) {
      this.query = u.username;
      this.selectedUser = u;
      this.suggestions = [];
      this.load();
    },

    async load() {
      if (this.query.length < 2) return;
      this.loading = true; this.error = null; this.stats = null; this.history = [];
      try {
        if (!this.selectedUser) {
          this.selectedUser = await resolveUser(this.query);
          if (!this.selectedUser) throw new Error(`User "${this.query}" not found`);
        }
        const { user_slug, data_region } = this.selectedUser;
        const [sRes, hRes] = await Promise.all([
          fetch(`/api/user/${user_slug}/stats?region=${data_region}`),
          fetch(`/api/user/${user_slug}/history?region=${data_region}`)
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
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      if (this.globalChart) { this.globalChart.destroy(); this.globalChart = null; }

      const base = getApexBase();
      this.chart = new ApexCharts(document.querySelector('#rankChart'), {
        ...base,
        chart: { ...base.chart, type: 'line', height: 320 },
        series: [{ name: 'Contest Rank', data: historyToSeries(this.history, 'rank'), color: CHART_COLORS.u1 }],
        yaxis: { ...base.yaxis, title: { text: 'Rank (lower = better)', style: { color: base.chart.foreColor } } },
        tooltip: { ...base.tooltip, custom: rankTooltipHtml },
      });
      this.chart.render();

      this.globalChart = new ApexCharts(document.querySelector('#globalChart'), {
        ...base,
        chart: { ...base.chart, type: 'line', height: 280 },
        series: [{ name: 'Global Ranking', data: historyToSeries(this.history, 'global_ranking'), color: CHART_COLORS.u2 }],
        yaxis: { ...base.yaxis, title: { text: 'Global Ranking', style: { color: base.chart.foreColor } } },
        tooltip: { ...base.tooltip, y: { formatter: v => `#${Math.round(v)}` } },
      });
      this.globalChart.render();
    },

    formatDate,
    pct: (rank, total) => total ? ((rank / total) * 100).toFixed(1) + '%' : '-',
  }));

  // ── Compare View ─────────────────────────────────────────────────
  Alpine.data('compareUsers', () => ({
    activeTab: 'single',
    query1: '', query2: '',
    suggestions1: [], suggestions2: [],
    user1: null, user2: null,
    loading: false, error: null,
    data: null,
    chart: null,
    globalChart: null,
    debounceTimer1: null, debounceTimer2: null,

    init() {
      window.addEventListener('themechange', () => {
        if (this.data) this.renderCharts();
      });
    },

    async onInput1() {
      this.user1 = null;
      clearTimeout(this.debounceTimer1);
      if (this.query1.length < 2) { this.suggestions1 = []; return; }
      this.debounceTimer1 = setTimeout(async () => {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(this.query1)}`);
        this.suggestions1 = await res.json();
      }, 250);
    },

    async onInput2() {
      this.user2 = null;
      clearTimeout(this.debounceTimer2);
      if (this.query2.length < 2) { this.suggestions2 = []; return; }
      this.debounceTimer2 = setTimeout(async () => {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(this.query2)}`);
        this.suggestions2 = await res.json();
      }, 250);
    },

    selectSuggestion1(u) { this.query1 = u.username; this.user1 = u; this.suggestions1 = []; },
    selectSuggestion2(u) { this.query2 = u.username; this.user2 = u; this.suggestions2 = []; },

    async compare() {
      if (this.query1.length < 2 || this.query2.length < 2) return;
      this.loading = true; this.error = null; this.data = null;
      try {
        if (!this.user1) {
          this.user1 = await resolveUser(this.query1);
          if (!this.user1) throw new Error(`User "${this.query1}" not found`);
        }
        if (!this.user2) {
          this.user2 = await resolveUser(this.query2);
          if (!this.user2) throw new Error(`User "${this.query2}" not found`);
        }
        const url = `/api/compare?u1=${this.user1.user_slug}&u2=${this.user2.user_slug}&r1=${this.user1.data_region}&r2=${this.user2.data_region}`;
        const res = await fetch(url);
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
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      if (this.globalChart) { this.globalChart.destroy(); this.globalChart = null; }

      const base = getApexBase();
      const s1 = { name: this.data.user1.stats.username, data: historyToSeries(this.data.user1.history, 'rank'), color: CHART_COLORS.u1 };
      const s2 = { name: this.data.user2.stats.username, data: historyToSeries(this.data.user2.history, 'rank'), color: CHART_COLORS.u2 };
      this.chart = new ApexCharts(document.querySelector('#compareRankChart'), {
        ...base,
        chart: { ...base.chart, type: 'line', height: 360 },
        series: [s1, s2],
        yaxis: { ...base.yaxis, title: { text: 'Rank (lower = better)', style: { color: base.chart.foreColor } } },
        tooltip: { ...base.tooltip, custom: rankTooltipHtml },
      });
      this.chart.render();

      const g1 = { name: this.data.user1.stats.username, data: historyToSeries(this.data.user1.history, 'global_ranking'), color: CHART_COLORS.u1 };
      const g2 = { name: this.data.user2.stats.username, data: historyToSeries(this.data.user2.history, 'global_ranking'), color: CHART_COLORS.u2 };
      this.globalChart = new ApexCharts(document.querySelector('#compareGlobalChart'), {
        ...base,
        chart: { ...base.chart, type: 'line', height: 300 },
        series: [g1, g2],
        yaxis: { ...base.yaxis, title: { text: 'Global Ranking', style: { color: base.chart.foreColor } } },
        tooltip: { ...base.tooltip, y: { formatter: v => `#${Math.round(v)}` } },
      });
      this.globalChart.render();
    },
  }));

});
