const state = {
  jobs: [],
  meta: {},
  saved: new Set(
    JSON.parse(localStorage.getItem('job-agent-saved') || '[]') || []
  )
};

const $ = id => document.getElementById(id);

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));

const strip = s =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const arr = v =>
  Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(',').map(x => x.trim()).filter(Boolean)
      : [];

const unique = key =>
  [...new Set(
    state.jobs
      .map(j => j[key])
      .filter(Boolean)
  )].sort((a, b) =>
    String(a).localeCompare(String(b))
  );


/* =========================================================
   DATA NORMALIZATION
========================================================= */

function normalize(payload) {
  state.jobs = Array.isArray(payload)
    ? payload
    : (payload?.jobs || []);

  state.meta = payload?.meta || {};
}


/* =========================================================
   SOURCE HELPERS
========================================================= */

function normalizeSource(source) {
  const s = String(source || '').toLowerCase().trim();

  if (s.includes('naukri')) return 'Naukri';
  if (s.includes('adzuna')) return 'Adzuna';

  return source
    ? String(source)
    : 'Unknown';
}

function sourceKey(j) {
  return normalizeSource(
    j.source ||
    j.job_source ||
    j.source_name ||
    ''
  );
}


/* =========================================================
   DATE HELPERS
========================================================= */

function parseJobDate(j) {
  const value =
    j.posted_at ||
    j.postedAt ||
    j.date_posted ||
    j.created_at ||
    j.createdAt ||
    j.date ||
    '';

  if (!value) return null;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d;
}


/*
 * Keep jobs from the last 3 months.
 *
 * Example:
 * Current date = 19 Sep 2026
 * Cutoff       = 19 Jun 2026
 */
function isWithinLastThreeMonths(j) {
  const posted = parseJobDate(j);

  /*
   * If a job has no valid date, keep it.
   * This prevents potentially useful jobs from disappearing
   * simply because a source did not provide a parseable date.
   */
  if (!posted) return true;

  const now = new Date();

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 3);

  return posted >= cutoff;
}


/* =========================================================
   DUPLICATE HELPERS
========================================================= */

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function duplicateKey(j) {
  /*
   * Prefer a real job ID when available.
   */
  const realId =
    j.id ||
    j.job_id ||
    j.jobId;

  if (realId) {
    return `${sourceKey(j)}|id|${normalizeText(realId)}`;
  }

  /*
   * Cross-source duplicate detection.
   *
   * We intentionally do NOT include source here.
   * Therefore the same job found on Naukri and Adzuna
   * can be recognized as a duplicate.
   */
  const title = normalizeText(j.title);
  const company = normalizeText(
    j.company ||
    j.companyName
  );
  const location = normalizeText(j.location);

  return `job|${title}|${company}|${location}`;
}

function deduplicateJobs(jobs) {
  const seen = new Set();
  const result = [];

  for (const job of jobs) {
    const key = duplicateKey(job);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(job);
  }

  return result;
}


/* =========================================================
   MATCH SCORE
========================================================= */

function calculateMatchScore(j) {
  /*
   * Use existing score if the scraper supplied one.
   */
  const existing = Number(
    j.match_score ??
    j.matchScore ??
    j.score
  );

  if (
    Number.isFinite(existing) &&
    existing > 0
  ) {
    return Math.max(0, Math.min(100, Math.round(existing)));
  }

  /*
   * Fallback scoring for mobile-development jobs.
   *
   * This prevents everything from displaying as 0%
   * when the backend did not calculate a score.
   */
  const text = [
    j.title,
    j.description,
    j.skills,
    j.experience,
    j.requirements
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!text.trim()) {
    return 0;
  }

  const keywords = [
    ['flutter', 25],
    ['dart', 15],
    ['ios', 20],
    ['swift', 20],
    ['swiftui', 20],
    ['android', 15],
    ['kotlin', 15],
    ['mobile', 15],
    ['mobile application', 15],
    ['mobile app', 15],
    ['react native', 20],
    ['firebase', 5],
    ['rest api', 5],
    ['api', 5],
    ['git', 5],
    ['mvvm', 5],
    ['bloc', 5],
    ['provider', 5]
  ];

  let score = 0;

  for (const [keyword, points] of keywords) {
    if (text.includes(keyword)) {
      score += points;
    }
  }

  /*
   * Strong title match.
   */
  const title = String(j.title || '').toLowerCase();

  if (
    title.includes('flutter developer') ||
    title.includes('ios developer') ||
    title.includes('mobile developer') ||
    title.includes('mobile application developer') ||
    title.includes('android developer')
  ) {
    score += 20;
  }

  return Math.max(
    0,
    Math.min(100, Math.round(score))
  );
}


/* =========================================================
   LOAD DATA
========================================================= */

async function load() {
  $('jobs').innerHTML = `
    <div class="empty">
      <div class="empty-icon">↻</div>
      <h2>Loading jobs…</h2>
      <p>Fetching the latest dashboard data.</p>
    </div>
  `;

  try {
    const r = await fetch(
      'data/jobs.json?ts=' + Date.now(),
      {
        cache: 'no-store'
      }
    );

    if (!r.ok) {
      throw new Error('data unavailable');
    }

    const payload = await r.json();

    normalize(payload);

    /*
     * Calculate fallback scores once after loading.
     */
    state.jobs = state.jobs.map(job => ({
      ...job,
      match_score: calculateMatchScore(job)
    }));

    renderFilters();
    render();

  } catch (e) {
    console.error(e);

    $('jobs').innerHTML = `
      <div class="empty">
        <div class="empty-icon">!</div>
        <h2>Dashboard data unavailable</h2>
        <p>
          Check that data/jobs.json exists and refresh the page.
        </p>
      </div>
    `;
  }
}


/* =========================================================
   FILTER DROPDOWNS
========================================================= */

function populate(id, values) {
  const el = $(id);

  if (!el) return;

  const current = el.value;

  while (el.options.length > 1) {
    el.remove(1);
  }

  values.forEach(v => {
    const o = document.createElement('option');

    o.value = v;
    o.textContent = v;

    el.appendChild(o);
  });

  if (values.includes(current)) {
    el.value = current;
  }
}


/*
 * Create Source filter dynamically.
 *
 * This means index.html does NOT need to be changed.
 */
function ensureSourceFilter() {
  if ($('source')) {
    return;
  }

  const sort = $('sort');

  if (!sort || !sort.parentElement) {
    return;
  }

  const wrapper = document.createElement('div');

  wrapper.className = 'filter-select';

  wrapper.innerHTML = `
    <select id="source" aria-label="Filter by job source">
      <option value="">All Sources</option>
    </select>
  `;

  sort.parentElement.insertBefore(
    wrapper,
    sort.parentElement.firstChild
  );

  $('source').addEventListener(
    'change',
    render
  );
}


function renderFilters() {
  ensureSourceFilter();

  populate(
    'location',
    unique('location')
  );

  populate(
    'employment',
    unique('employment_type')
  );

  populate(
    'experience',
    unique('experience')
  );

  const sources = [
    ...new Set(
      state.jobs
        .map(sourceKey)
        .filter(Boolean)
    )
  ].sort();

  populate(
    'source',
    sources
  );
}


/* =========================================================
   FILTER JOBS
========================================================= */

function filteredJobs() {
  const q = $('search')
    .value
    .toLowerCase()
    .trim();

  const loc = $('location').value;
  const type = $('employment').value;
  const exp = $('experience').value;

  const source =
    $('source')?.value || '';

  const sort = $('sort').value;

  /*
   * First remove old jobs.
   */
  const recentJobs = state.jobs.filter(
    isWithinLastThreeMonths
  );

  /*
   * Then remove duplicates.
   */
  const uniqueJobs = deduplicateJobs(
    recentJobs
  );

  const jobs = uniqueJobs.filter(j => {
    const hay = [
      j.title,
      j.company,
      j.companyName,
      j.location,
      j.description,
      j.skills,
      j.source,
      j.employment_type,
      j.experience
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchesSearch =
      !q ||
      hay.includes(q);

    const matchesLocation =
      !loc ||
      j.location === loc;

    const matchesType =
      !type ||
      j.employment_type === type;

    const matchesExperience =
      !exp ||
      j.experience === exp;

    const matchesSource =
      !source ||
      sourceKey(j) === source;

    return (
      matchesSearch &&
      matchesLocation &&
      matchesType &&
      matchesExperience &&
      matchesSource
    );
  });

  jobs.sort((a, b) => {
    if (sort === 'company') {
      return String(
        a.company ||
        a.companyName ||
        ''
      ).localeCompare(
        String(
          b.company ||
          b.companyName ||
          ''
        )
      );
    }

    if (sort === 'title') {
      return String(
        a.title || ''
      ).localeCompare(
        String(
          b.title || ''
        )
      );
    }

    if (sort === 'newest') {
      const da =
        parseJobDate(a)?.getTime() || 0;

      const db =
        parseJobDate(b)?.getTime() || 0;

      return db - da;
    }

    return (
      Number(
        b.match_score || 0
      ) -
      Number(
        a.match_score || 0
      )
    );
  });

  return jobs;
}


/* =========================================================
   RENDER
========================================================= */

function render() {
  const jobs = filteredJobs();

  const source =
    $('source')?.value || '';

  const recentUniqueCount =
    deduplicateJobs(
      state.jobs.filter(
        isWithinLastThreeMonths
      )
    ).length;

  let countText;

  if (source) {
    countText =
      `Showing ${jobs.length} of ${recentUniqueCount} recent unique jobs`;
  } else {
    countText =
      `Showing ${jobs.length} of ${recentUniqueCount} recent unique jobs`;
  }

  $('count').textContent =
    countText;

  renderChips();

  $('jobs').innerHTML =
    jobs
      .map((j, i) => card(j, i))
      .join('');

  $('empty')
    .classList
    .toggle(
      'hidden',
      jobs.length > 0
    );

  renderStats();
}


/* =========================================================
   FILTER CHIPS
========================================================= */

function renderChips() {
  const chips = [];

  if ($('search').value.trim()) {
    chips.push([
      'Search',
      $('search').value.trim(),
      'search'
    ]);
  }

  if ($('source')?.value) {
    chips.push([
      'Source',
      $('source').value,
      'source'
    ]);
  }

  if ($('location').value) {
    chips.push([
      'Location',
      $('location').value,
      'location'
    ]);
  }

  if ($('employment').value) {
    chips.push([
      'Job type',
      $('employment').value,
      'employment'
    ]);
  }

  if ($('experience').value) {
    chips.push([
      'Experience',
      $('experience').value,
      'experience'
    ]);
  }

  $('chips').innerHTML =
    chips
      .map(
        ([label, val, key]) =>
          `<span class="chip">
            ${escapeHtml(label)}:
            ${escapeHtml(val)}
            <button
              data-clear="${escapeHtml(key)}"
              aria-label="Remove ${escapeHtml(label)} filter"
            >×</button>
          </span>`
      )
      .join('');
}


/* =========================================================
   COMPANY LOGO
========================================================= */

function logoFor(j) {
  const c = String(
    j.company ||
    j.companyName ||
    'Company'
  ).trim();

  return escapeHtml(
    (c[0] || 'C').toUpperCase()
  );
}


/* =========================================================
   JOB CARD
========================================================= */

function card(j, i) {
  const skills =
    arr(j.skills).slice(0, 6);

  const exp =
    j.experience || '';

  const type =
    j.employment_type ||
    j.workMode ||
    'Full-time';

  const location =
    j.location ||
    'Location not listed';

  const company =
    j.company ||
    j.companyName ||
    'Company not listed';

  const score =
    calculateMatchScore(j);

  const id =
    j.id ||
    j.job_id ||
    j.jobId ||
    j.original_url ||
    j.redirect_url ||
    `${j.title || 'job'}-${company}-${location}`;

  const saved =
    state.saved.has(
      String(id)
    );

  const desc =
    strip(j.description);

  const posted =
    parseJobDate(j)
      ? formatPosted(
          parseJobDate(j)
        )
      : 'Date not listed';

  const source =
    sourceKey(j);

  return `
    <article class="job">

      <div class="company-logo alt${i % 5}">
        ${logoFor(j)}
      </div>

      <div class="job-main">

        <div class="job-title-row">

          <h2 class="job-title">
            ${escapeHtml(
              j.title ||
              'Untitled role'
            )}
          </h2>

          <span class="score">
            ${score}% Match
          </span>

        </div>

        <div class="company">
          ${escapeHtml(company)}
        </div>

        <div class="meta-grid">

          <span class="meta-item">
            <span class="meta-icon">⌖</span>
            ${escapeHtml(location)}
          </span>

          <span class="meta-item">
            <span class="meta-icon">▣</span>
            ${escapeHtml(type)}
          </span>

          <span class="meta-item">
            <span class="meta-icon">◒</span>
            ${escapeHtml(
              exp ||
              'Experience not listed'
            )}
          </span>

          <span class="meta-item">
            <span class="meta-icon">♧</span>
            ${escapeHtml(
              j.company_size ||
              'Company size: Unknown'
            )}
          </span>

        </div>

        ${
          source
            ? `
              <div class="job-source">
                ${escapeHtml(source)}
              </div>
            `
            : ''
        }

        ${
          skills.length
            ? `
              <div class="skills">
                ${skills
                  .map(
                    (s, n) =>
                      `<span class="tag${
                        n > 3
                          ? ' neutral'
                          : ''
                      }">
                        ${escapeHtml(s)}
                      </span>`
                  )
                  .join('')}
              </div>
            `
            : ''
        }

        ${
          desc
            ? `
              <div class="description">
                ${escapeHtml(desc)}
              </div>
            `
            : ''
        }

      </div>

      <div class="job-actions">

        <div class="posted">
          ${escapeHtml(posted)}
        </div>

        <button
          class="bookmark ${saved ? 'saved' : ''}"
          data-save="${escapeHtml(
            String(id)
          )}"
          title="${
            saved
              ? 'Remove saved job'
              : 'Save job'
          }"
          aria-label="${
            saved
              ? 'Remove saved job'
              : 'Save job'
          }"
        >
          ${saved ? '★' : '☆'}
        </button>

        <a
          class="view"
          href="${escapeHtml(
            j.original_url ||
            j.redirect_url ||
            j.url ||
            '#'
          )}"
          target="_blank"
          rel="noopener"
        >
          View Job ↗
        </a>

      </div>

    </article>
  `;
}


/* =========================================================
   DATE DISPLAY
========================================================= */

function formatPosted(value) {
  const d =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      d.getTime()
    )
  ) {
    return 'Date not listed';
  }

  return d.toLocaleDateString(
    undefined,
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }
  );
}


/* =========================================================
   STATS
========================================================= */

function renderStats() {
  const m =
    state.meta || {};

  const allRecent =
    state.jobs.filter(
      isWithinLastThreeMonths
    );

  const uniqueRecent =
    deduplicateJobs(
      allRecent
    );

  const sources =
    Object.keys(
      m.sources || {}
    );

  const source =
    sources[0] ||
    state.jobs.find(
      j => j.source
    )?.source ||
    'Naukri + Adzuna';

  /*
   * Count source totals from the actual data.
   */
  const naukriCount =
    uniqueRecent.filter(
      j => sourceKey(j) === 'Naukri'
    ).length;

  const adzunaCount =
    uniqueRecent.filter(
      j => sourceKey(j) === 'Adzuna'
    ).length;

  const cards = [
    [
      '▣',
      'Jobs Collected',
      state.jobs.length,
      'Raw jobs from Naukri + Adzuna'
    ],
    [
      '▤',
      'Unique Jobs',
      uniqueRecent.length,
      'Recent jobs after deduplication'
    ],
    [
      '✦',
      'New Jobs',
      m.new_jobs ??
      uniqueRecent.length,
      'Available in latest run'
    ],
    [
      '☆',
      'Matched Jobs',
      uniqueRecent.length,
      'Jobs from the last 3 months'
    ],
    [
      '◎',
      'Source Status',
      `${naukriCount} Naukri · ${adzunaCount} Adzuna`,
      'Sources available'
    ]
  ];

  $('stats').innerHTML =
    cards
      .map(
        (c, i) =>
          i === 4
            ? `
              <div class="stat">

                <div class="stat-icon">
                  ${c[0]}
                </div>

                <div class="stat-copy">

                  <div class="stat-label">
                    ${c[1]}
                  </div>

                  <div class="source-status">
                    <span class="mini-dot"></span>
                    ${escapeHtml(c[2])}
                    <span class="enabled">
                      Enabled
                    </span>
                  </div>

                  <div class="stat-sub">
                    ${escapeHtml(c[3])}
                  </div>

                </div>

              </div>
            `
            : `
              <div class="stat">

                <div class="stat-icon">
                  ${c[0]}
                </div>

                <div class="stat-copy">

                  <div class="stat-label">
                    ${c[1]}
                  </div>

                  <div class="stat-value">
                    ${escapeHtml(c[2])}
                  </div>

                  <div class="stat-sub">
                    ${escapeHtml(c[3])}
                  </div>

                </div>

              </div>
            `
      )
      .join('');

  if ($('sourceName')) {
    $('sourceName').textContent =
      source;
  }

  const raw =
    m.last_run_utc ||
    m.updated_at ||
    m.updated_at_utc;

  const formatted =
    raw
      ? new Date(raw).toLocaleString(
          undefined,
          {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short'
          }
        )
      : 'Waiting for first run';

  if ($('updated')) {
    $('updated').textContent =
      formatted;
  }

  if ($('footerUpdated')) {
    $('footerUpdated').textContent =
      'Last updated: ' +
      formatted;
  }
}


/* =========================================================
   CLEAR FILTERS
========================================================= */

function clearFilters() {
  $('search').value = '';
  $('location').value = '';
  $('employment').value = '';
  $('experience').value = '';
  $('sort').value = 'score';

  if ($('source')) {
    $('source').value = '';
  }

  render();
}


/* =========================================================
   EVENT LISTENERS
========================================================= */

$('search')
  .addEventListener(
    'input',
    render
  );

[
  'location',
  'employment',
  'experience',
  'sort'
].forEach(id => {
  $(id).addEventListener(
    'change',
    render
  );
});

$('clear')
  .addEventListener(
    'click',
    clearFilters
  );

$('emptyClear')
  .addEventListener(
    'click',
    clearFilters
  );

$('refresh')
  .addEventListener(
    'click',
    () => load()
  );

$('runSearch')
  .addEventListener(
    'click',
    () => load()
  );


/* =========================================================
   FILTER CHIP CLICK
========================================================= */

$('chips')
  .addEventListener(
    'click',
    e => {
      const key =
        e.target.dataset.clear;

      if (!key) return;

      if (key === 'search') {
        $('search').value = '';
      } else if (
        key === 'source' &&
        $('source')
      ) {
        $('source').value = '';
      } else {
        $(key).value = '';
      }

      render();
    }
  );


/* =========================================================
   SAVE / BOOKMARK JOB
========================================================= */

$('jobs')
  .addEventListener(
    'click',
    e => {
      const btn =
        e.target.closest(
          '[data-save]'
        );

      if (!btn) return;

      const id =
        String(
          btn.dataset.save
        );

      if (
        state.saved.has(id)
      ) {
        state.saved.delete(id);
      } else {
        state.saved.add(id);
      }

      localStorage.setItem(
        'job-agent-saved',
        JSON.stringify(
          [...state.saved]
        )
      );

      render();
    }
  );


/* =========================================================
   START
========================================================= */

load();
