const CHART_COLORS = { u1: '#f89f1b', u2: '#00b8d9' };

const APEX_BASE = {
  chart: { background: '#1a1d27', foreColor: '#7a7f9a', toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } }, animations: { enabled: true, speed: 400 } },
  grid: { borderColor: '#2e3250', strokeDashArray: 4 },
  tooltip: { theme: 'dark', x: { format: 'MMM yyyy' } },
  xaxis: { type: 'datetime', labels: { style: { colors: '#7a7f9a' } } },
  yaxis: { reversed: true, labels: { style: { colors: '#7a7f9a' }, formatter: v => Math.round(v) } },
  legend: { labels: { colors: '#e4e6f0' } },
  stroke: { curve: 'smooth', width: 3 },
  markers: { size: 4, hover: { size: 7 } },
};

function formatDate(unixTs) {
  return new Date(unixTs * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function historyToSeries(history, field = 'rank') {
  return history.map(h => ({ x: h.time * 1000, y: h[field] }));
}

document.addEventListener('alpine:init', () => {

  // ── Single User View ──────────────────────────────────────────────
  Alpine.data('singleUser', () => ({
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

    async onInput() {
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
      if (!this.selectedUser) return;
      this.loading = true; this.error = null; this.stats = null; this.history = [];
      try {
        const { user_slug, data_region } = this.selectedUser;
        const [sRes, hRes] = await Promise.all([
          fetch(`/api/user/${user_slug}/stats?region=${data_region}`),
          fetch(`/api/user/${user_slug}/history?region=${data_region}`)
        ]);
        if (!sRes.ok) throw new Error((await sRes.json()).error);
        this.stats = await sRes.json();
        this.history = await hRes.json();
        await this.$nextTick();
        this.renderCharts();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    renderCharts() {
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      if (this.globalChart) { this.globalChart.destroy(); this.globalChart = null; }

      const rankSeries = [{ name: 'Contest Rank', data: historyToSeries(this.history, 'rank'), color: CHART_COLORS.u1 }];
      this.chart = new ApexCharts(document.querySelector('#rankChart'), {
        ...APEX_BASE,
        chart: { ...APEX_BASE.chart, type: 'line', height: 320 },
        series: rankSeries,
        yaxis: { ...APEX_BASE.yaxis, title: { text: 'Rank (lower = better)', style: { color: '#7a7f9a' } } },
        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => `#${v}` } },
      });
      this.chart.render();

      const globalSeries = [{ name: 'Global Ranking', data: historyToSeries(this.history, 'global_ranking'), color: CHART_COLORS.u2 }];
      this.globalChart = new ApexCharts(document.querySelector('#globalChart'), {
        ...APEX_BASE,
        chart: { ...APEX_BASE.chart, type: 'line', height: 280 },
        series: globalSeries,
        yaxis: { ...APEX_BASE.yaxis, title: { text: 'Global Ranking', style: { color: '#7a7f9a' } } },
        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => `#${Math.round(v)}` } },
      });
      this.globalChart.render();
    },

    formatDate,
    pct: (rank, total) => total ? ((rank / total) * 100).toFixed(1) + '%' : '-',
  }));

  // ── Compare View ─────────────────────────────────────────────────
  Alpine.data('compareUsers', () => ({
    query1: '', query2: '',
    suggestions1: [], suggestions2: [],
    user1: null, user2: null,
    loading: false, error: null,
    data: null,
    chart: null,
    globalChart: null,
    debounceTimer1: null, debounceTimer2: null,

    async onInput1() {
      clearTimeout(this.debounceTimer1);
      if (this.query1.length < 2) { this.suggestions1 = []; return; }
      this.debounceTimer1 = setTimeout(async () => {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(this.query1)}`);
        this.suggestions1 = await res.json();
      }, 250);
    },

    async onInput2() {
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
      if (!this.user1 || !this.user2) return;
      this.loading = true; this.error = null; this.data = null;
      try {
        const url = `/api/compare?u1=${this.user1.user_slug}&u2=${this.user2.user_slug}&r1=${this.user1.data_region}&r2=${this.user2.data_region}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error((await res.json()).error);
        this.data = await res.json();
        await this.$nextTick();
        this.renderCharts();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    renderCharts() {
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      if (this.globalChart) { this.globalChart.destroy(); this.globalChart = null; }

      const s1 = { name: this.data.user1.stats.username, data: historyToSeries(this.data.user1.history, 'rank'), color: CHART_COLORS.u1 };
      const s2 = { name: this.data.user2.stats.username, data: historyToSeries(this.data.user2.history, 'rank'), color: CHART_COLORS.u2 };

      this.chart = new ApexCharts(document.querySelector('#compareRankChart'), {
        ...APEX_BASE,
        chart: { ...APEX_BASE.chart, type: 'line', height: 360 },
        series: [s1, s2],
        yaxis: { ...APEX_BASE.yaxis, title: { text: 'Rank (lower = better)', style: { color: '#7a7f9a' } } },
        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => `#${v}` } },
      });
      this.chart.render();

      const g1 = { name: this.data.user1.stats.username, data: historyToSeries(this.data.user1.history, 'global_ranking'), color: CHART_COLORS.u1 };
      const g2 = { name: this.data.user2.stats.username, data: historyToSeries(this.data.user2.history, 'global_ranking'), color: CHART_COLORS.u2 };

      this.globalChart = new ApexCharts(document.querySelector('#compareGlobalChart'), {
        ...APEX_BASE,
        chart: { ...APEX_BASE.chart, type: 'line', height: 300 },
        series: [g1, g2],
        yaxis: { ...APEX_BASE.yaxis, title: { text: 'Global Ranking', style: { color: '#7a7f9a' } } },
        tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => `#${Math.round(v)}` } },
      });
      this.globalChart.render();
    },
  }));

});
