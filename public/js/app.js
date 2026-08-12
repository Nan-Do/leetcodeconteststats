// `best` is --success from the stylesheet: the one point on a line that is worth
// looking at on its own, in a colour neither user's line can be confused with.
// `unrated` is the same idea for a contest that never counted -- a violet that
// is nobody's line and is not the green that means "best".
const CHART_COLORS = { u1: '#f89f1b', u2: '#00b8d9', best: '#36b37e', unrated: '#8a63d2' };

// Must match MIN_QUERY_LENGTH in routes/api.js — searching below the server's
// own minimum returns an empty list, which reads as "no such user".
const MIN_QUERY_LENGTH = 2;

// The API lets a browser keep a reply for an hour, so a response can outlive the
// deploy that changed its shape: a page loaded minutes after one can still be
// handed the previous version's answer for a user it has already looked up. The
// URL is the cache key, so bumping this retires them. Bump it whenever an
// endpoint's response shape changes.
const API_VERSION = 3;

function apiUrl(path, params = {}) {
  return `/api/${path}?${new URLSearchParams({ ...params, v: API_VERSION })}`;
}

// Must match the rule db.js applies: a contest counts as attended when the user
// scored in it. A row with a score of 0 is a contest they registered for and
// either sat out or submitted nothing in.
const hasAttended = (contest) => contest.score > 0;

// The server marks a contest unrated when the user scored in it and LeetCode's
// rated history does not list it. Nothing is marked for a CN account, which
// leetcode.com has no record of.
const isRated = (contest) => !contest.unrated;

const SKIP_FILTER_KEY = 'hideSkipped';
const UNRATED_FILTER_KEY = 'hideUnrated';

// A stat with no contests behind it — every contest hidden, say — has nothing to
// report rather than a zero.
const dash = (value, prefix = '') => (value === null || value === undefined ? '—' : prefix + value);

const pct = (part, total) => (total ? ((part / total) * 100).toFixed(1) + '%' : '-');

// LeetCode carries the rating to three decimals and shows it rounded, so the
// card, the compare column and the chart tooltip all round the same way rather
// than each picking their own.
function formatRating(rating, trend_direction) {
  let trend_char = '';
  if (trend_direction === "UP") trend_char = " <span style=\"color: green;\">↑</span>";
  else if (trend_direction === "DOWN") trend_char = " <span style=\"color: red;\">↓</span>";
  return (rating === null || rating === undefined ? '—' : `${Math.round(rating).toLocaleString('en-US')}${trend_char}`);
}


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
  return history.map(h => ({ x: h.time * 1000, y: h[field], contest_slug: h.contest_slug, user_score: h.score, contest_score: h.contest_score, total_time: h.total_time, solved: h.solved, rating: h.rating, unrated: h.unrated, skipped: !hasAttended(h), trend_direction: h.trend_direction }));
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

  // Say why the point is marked out from the rest of the line, each in the
  // colour it is marked in. A contest can be two of these at once: the best
  // rank on the chart is worth knowing about whether or not it was ever rated.
  const notes = [];
  if (point.skipped) notes.push({ text: 'Skipped — no score in this contest', color: muted });
  if (point.unrated) notes.push({ text: 'Unrated — the result stands, the rating did not move', color: CHART_COLORS.unrated });
  if (point.best) notes.push({ text: 'Best rank on the chart', color: CHART_COLORS.best });

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
    ${point.rating != null ? row('Rating:', formatRating(point.rating, point.trend_direction)) : ''}
    ${row('Rank:', `#${rank}`)}
    ${row('Solved:', `${point.solved}`)}
    ${row('Score:', `${point.user_score}/${point.contest_score}`)}
    ${row('Time:', `${point.total_time}`)}
    ${notes.length ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${border};font-size:11px">
      ${notes.map(note => `<div style="color:${note.color}">${note.text}</div>`).join('')}
    </div>` : ''}
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

  // Three points on a line are worth picking out of it, and marking each is what
  // makes them mean something: a hollow grey dot for a contest that was skipped
  // -- "no result", where a filled one would read as a genuinely terrible one --
  // a violet square for one that was never rated, and green for the best rank on
  // the chart. The best is taken from the points actually drawn, so a skipped
  // contest can never claim it, and a rank matched more than once is marked
  // every time it was reached.
  //
  // Shape and colour say different things, so the two compose: an unrated
  // contest that is also the best rank stays a square and turns green.
  const marks = [];
  series.forEach((s, seriesIndex) => {
    const best = Math.min(...s.data.filter(point => !point.skipped).map(point => point.y));
    s.data.forEach((point, dataPointIndex) => {
      // Read back by the tooltip. Set before the chart is handed the series, so
      // it is there whether or not ApexCharts copies the points.
      point.best = !point.skipped && point.y === best;

      if (point.skipped) {
        marks.push({ seriesIndex, dataPointIndex, size: 4, fillColor: base.chart.background, strokeColor: base.chart.foreColor });
      } else if (point.unrated) {
        marks.push({ seriesIndex, dataPointIndex, size: 5, shape: 'square', fillColor: point.best ? CHART_COLORS.best : CHART_COLORS.unrated, strokeColor: base.chart.background });
      } else if (point.best) {
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

// The two switches under the chart. Both views own a set, and between them they
// answer every question a binding downstream asks: which contests to draw, and
// which of the blocks the server sent to read the figures out of.
function contestFilter() {
  return {
    // Skipped contests are hidden to begin with. A contest nobody competed in
    // is not a result, and left in it says more about where the rank axis ends
    // than about anyone's form. Only an explicit "false" -- the switch turned
    // off on an earlier visit -- brings them back.
    hideSkipped: localStorage.getItem(SKIP_FILTER_KEY) !== 'false',

    // Unrated ones are hidden to begin with, because they are results: the user
    // turned up and finished where they finished, and only the rating was left
    // alone. The switch is for reading the history as LeetCode's rating saw it.
    hideUnrated: localStorage.getItem(UNRATED_FILTER_KEY) !== 'false',

    // Which contests to count is a standing preference rather than something to
    // say again for every user looked up, so it persists like the theme does.
    // The switches have already written both flags through x-model.
    remember() {
      localStorage.setItem(SKIP_FILTER_KEY, this.hideSkipped ? 'true' : 'false');
      localStorage.setItem(UNRATED_FILTER_KEY, this.hideUnrated ? 'true' : 'false');
    },

    // Names the set the two switches leave standing. The server tallied all
    // four under these keys -- stats, and the head-to-head in the compare view
    // -- so flipping a switch costs a lookup rather than a request.
    key() {
      if (this.hideSkipped) return this.hideUnrated ? 'attended_rated' : 'attended';
      return this.hideUnrated ? 'rated' : 'all';
    },

    history(history) {
      return history.filter(contest =>
        (!this.hideSkipped || hasAttended(contest)) && (!this.hideUnrated || isRated(contest)));
    },

    stats(stats) {
      return stats[this.key()];
    },
  };
}

// LeetCode awards two contest badges, Knight and Guardian. The stylesheet
// colours the two it knows by name; anything it is shown later still renders,
// as a plain chip.
function badgeOf(ranking) {
  const name = ranking?.badge?.name;
  return name ? { name, cls: 'badge-' + name.toLowerCase().replace(/\s+/g, '-') } : null;
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
    filter: contestFilter(),
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

    // LeetCode's profile summary — rating, badge, global standing. Null for a CN
    // account, and for a lookup of a US one that failed.
    get ranking() {
      return this.stats?.ranking ?? null;
    },

    get badge() {
      return badgeOf(this.ranking);
    },

    ratingText() {
      return formatRating(this.ranking?.rating);
    },

    bestRatingText() {
      if (this.shownStats.best_rating > 0) return formatRating(this.shownStats.best_rating);
      else return formatRating();
    },

    // Best and average rank read as one figure, because they are one figure
    // seen twice: where the user has got to, and where they usually land.
    rankValue() {
      const { best_rank, avg_rank } = this.shownStats;
      // Tenths of a place mean nothing at the size this is set in.
      return `${dash(best_rank, '#')} / ${dash(avg_rank === null ? null : Math.round(avg_rank), '#')}`;
    },

    // The same two against the fields they were set in, which is what makes a
    // rank comparable across contests that drew 10,000 entrants and 40,000.
    rankSub() {
      return `${this.bestRankPct()} / ${this.avgRankPct()}`;
    },

    // The field size has to come from the same contests the card counted:
    // looking the rank up across the whole history lets a skipped contest that
    // happens to share the number answer for the one that earned it.
    bestRankPct() {
      const contest = this.shownHistory.find(h => h.rank === this.shownStats.best_rank);
      return contest ? 'Top ' + pct(contest.rank, contest.num_participants) : '—';
    },

    // The average of each contest's own share, not the average rank over the
    // average field: the first answers "how far up does this user finish", the
    // second is pulled about by how big the contests happened to be.
    avgRankPct() {
      const contests = this.shownHistory.filter(h => h.num_participants > 0);
      if (!contests.length) return '—';
      const share = contests.reduce((n, h) => n + h.rank / h.num_participants, 0) / contests.length;
      return 'Top ' + (share * 100).toFixed(1) + '%';
    },

    filterNote() {
      if (!this.stats) return '';
      const skipped = this.stats.skipped_count;
      if (!skipped) return 'No skipped contests';
      return `${skipped} of ${this.stats.all.total_contests} contests ${this.filter.hideSkipped ? 'hidden' : 'skipped'}`;
    },

    unratedNote() {
      if (!this.stats) return '';
      const unrated = this.stats.unrated_count;
      if (!unrated) return 'No unrated contests';
      return `${unrated} of ${this.stats.all.total_contests} contests ${this.filter.hideUnrated ? 'hidden' : 'unrated'}`;
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
    filter: contestFilter(),
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
      return this.data.wins[this.filter.key()][`user${n}`];
    },

    ranking(n) {
      return this.data[`user${n}`].stats.ranking;
    },

    badge(n) {
      return badgeOf(this.ranking(n));
    },

    ratingText(n) {
      return formatRating(this.ranking(n)?.rating);
    },

    bestRatingText(n) {
      if (this.stats(n).best_rating > 0) return formatRating(this.stats(n).best_rating);
      else return formatRating();
    },

    // Neither column has anything to say about ratings when neither account is
    // one leetcode.com knows.
    hasRatingData() {
      return Boolean(this.data && (this.ranking(1) || this.ranking(2)));
    },

    filterNote() {
      if (!this.data) return '';
      const s1 = this.data.user1.stats;
      const s2 = this.data.user2.stats;
      if (!s1.skipped_count && !s2.skipped_count) return 'No skipped contests';
      return `${this.filter.hideSkipped ? 'Hidden' : 'Skipped'} — ${s1.user_slug}: ${s1.skipped_count} · ${s2.user_slug}: ${s2.skipped_count}`;
    },

    unratedNote() {
      if (!this.data) return '';
      const s1 = this.data.user1.stats;
      const s2 = this.data.user2.stats;
      if (!s1.unrated_count && !s2.unrated_count) return 'No unrated contests';
      return `${this.filter.hideUnrated ? 'Hidden' : 'Unrated'} — ${s1.user_slug}: ${s1.unrated_count} · ${s2.user_slug}: ${s2.unrated_count}`;
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
