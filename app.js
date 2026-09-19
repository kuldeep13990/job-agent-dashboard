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


/* =========================================================
   SOURCE HELPERS
   ========================================================= */

function normalizeSource(job) {
  const raw = String(
    job.source ||
    job.source_name ||
    job.platform ||
    job.job_source ||
    ''
  ).trim().toLowerCase();

  const url = String(
    job.original_url ||
    job.redirect_url ||
    job.url ||
    ''
  ).toLowerCase();

  if (
    raw.includes('naukri') ||
    url.includes('naukri.com')
  ) {
    return 'Naukri';
  }

  if (
    raw.includes('adzuna') ||
    url.includes('adzuna')
  ) {
    return 'Adzuna';
  }

  if (raw) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  return 'Unknown';
}


/* =========================================================
   DATE HELPERS
   ========================================================= */

function getDateValue(job) {
  return (
    job.posted_at ||
    job.postedAt ||
    job.created_at ||
    job.createdAt ||
    job.date ||
    job.created ||
    ''
  );
}

function parseJobDate(value) {
  if (!value) return null;

  const d = new Date(value);

  if (!Number.isNaN(d.getTime())) {
    return d;
  }

  return null;
}

function threeMonthsAgo() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - 3);
  return d;
}

function isWithinLastThreeMonths(job) {
  const raw = getDateValue(job);
  const date = parseJobDate(raw);

  /*
   * If a job has no usable date, keep it rather than
   * accidentally deleting potentially useful jobs.
   */
  if (!date) return true;

  return date >= threeMonthsAgo();
}


/* =========================================================
   DEDUPLICATION
   ========================================================= */

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getJobUrl(job) {
  return String(
    job.original_url ||
    job.redirect_url ||
    job.url ||
    ''
  ).trim();
}

function getJobId(job) {
  return String(
    job.id ||
    job.job_id ||
    job.jobId ||
    job.jobID ||
    ''
  ).trim();
}

function getDuplicateKey(job) {
  const source = normalizeSource(job);
  const id = getJobId(job);

  /*
   * Best case:
   * same source + same job ID = same job.
   */
  if (id) {
    return `id|${source}|${normalizeText(id)}`;
  }

  /*
   * Next best:
   * same source + same original URL.
   */
  const url = getJobUrl(job);

  if (url) {
    return `url|${source}|${normalizeText(url)}`;
  }

  /*
   * Fallback:
   * same source + title + company + location.
   */
  return [
    'text',
    source,
    normalizeText(job.title),
    normalizeText(job.company || job.companyName),
    normalizeText(job.location)
  ].join('|');
}

function deduplicateJobs(jobs) {
  const seen = new Set();
  const result = [];

  for (const job of jobs) {
    const key = getDuplicateKey(job);

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(job);
  }

  return result;
}


/* =========================================================
   NORMALIZATION
   ========================================================= */

function normalizeJob(job) {
  const normalized = {
    ...job
  };

  normalized.source = normalizeSource(job);

  /*
   * Make different field names compatible with the dashboard.
   */
  if (!normalized.company && normalized.companyName) {
    normalized.company = normalized.companyName;
  }

  if (!normalized.original_url && normalized.url) {
    normalized.original_url = normalized.url;
  }

  if (!normalized.posted_at) {
    normalized.posted_at =
      normalized.postedAt ||
      normalized.created_at ||
      normalized.createdAt ||
      normalized.date ||
      normalized.created ||
      '';
  }

  if (!normalized.employment_type && normalized.workMode) {
    normalized.employment_type = normalized.workMode;
  }

  if (!normalized.experience && normalized.experienceText) {
    normalized.experience = normalized.experienceText;
  }

  /*
   * Preserve match_score if the workflow already calculated it.
   * Also support alternate field names.
   */
  if (
    normalized.match_score === undefined ||
    normalized.match_score === null ||
    normalized.match_score === ''
  ) {
    if (normalized.matchScore !== undefined) {
      normalized.match_score = normalized.matchScore;
    } else if (normalized.match_percentage !== undefined) {
      normalized.match_score = normalized.match_percentage;
    } else {
      normalized.match_score = 0;
    }
  }

  return normalized;
}


/* =========================================================
   LOAD DATA
   ========================================================= */

function normalize(payload) {
  let jobs = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.jobs)
      ? payload.jobs
      : [];

  state.meta = payload?.meta || {};

  jobs = jobs
    .map(normalizeJob)
    .filter(Boolean);

  /*
   * Keep only jobs from the last 3 months.
   */
  jobs = jobs.filter(isWithinLastThreeMonths);

  /*
   * Remove duplicate records.
   */
  jobs = deduplicateJobs(jobs);

  /*
   * Newest first internally.
   */
  jobs.sort((a, b) => {
    const da = parseJobDate(getDateValue(a));
    const db = parseJobDate(getDateValue(b));

    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;

    return db - da;
  });

  state.jobs = jobs;
}


/* =========================================================
   DATA LOADING
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

    renderFilters();
    render();

  } catch (e) {
    console.error('Dashboard load error:', e);

    $('jobs').innerHTML = `
      <div class="empty">
        <div class="empty-icon">!</div>
        <h2>Dashboard data unavailable</h2>
        <p>Check that data/jobs.json exists and refresh the page.</p>
      </div>
    `;
  }
}


/* =========================================================
   FILTER OPTIONS
   ========================================================= */

function unique(key) {
  return [
    ...new Set(
      state.jobs
        .map(j => j[key])
        .filter(Boolean)
    )
  ].sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function uniqueSources() {
  return [
    ...new Set(
      state.jobs
        .map(j => normalizeSource(j))
        .filter(Boolean)
    )
  ].sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function populate(id, values, allLabel = null) {
  const el = $(id);

  if (!el) return;

  const current = el.value;

  /*
   * Preserve the first option.
   */
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
  } else if (allLabel !== null) {
    el.value = '';
  }
}


/* =========================================================
   MAKE SOURCE + SORT LOOK LIKE OTHER FILTERS
   ========================================================= */

function matchFilterStyle(targetId, referenceId = 'location') {
  const target = $(targetId);
  const reference = $(referenceId);

  if (!target || !reference) return;

  /*
   * Copy the same CSS class(es) used by the existing filters.
   */
  if (reference.className) {
    target.className = reference.className;
  }

  /*
   * Preserve usability even if the existing CSS is restrictive.
   */
  target.style.minWidth = targetId === 'sort'
    ? '155px'
    : '190px';

  target.style.height = reference.offsetHeight
    ? `${reference.offsetHeight}px`
    : '42px';

  target.style.boxSizing = 'border-box';
}

function renderFilters() {
  /*
   * Source dropdown.
   *
   * IMPORTANT:
   * This will contain Naukri only if Naukri records are actually
   * present inside data/jobs.json.
   */
  if ($('source')) {
    populate(
      'source',
      uniqueSources()
    );

    matchFilterStyle('source', 'location');
  }

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

  /*
   * Make Sort By easier to see.
   */
  if ($('sort')) {
    matchFilterStyle('sort', 'location');

    $('sort').style.minWidth = '155px';
    $('sort').style.width = '155px';
    $('sort').style.flex = '0 0 155px';
  }
}


/* =========================================================
   FILTERED JOBS
   ========================================================= */

function filteredJobs() {
  const q = $('search')
    ? $('search').value.toLowerCase().trim()
    : '';

  const source = $('source')
    ? $('source').value
    : '';

  const loc = $('location')
    ? $('location').value
    : '';

  const type = $('employment')
    ? $('employment').value
    : '';

  const exp = $('experience')
    ? $('experience').value
    : '';

  const sort = $('sort')
    ? $('sort').value
    : 'score';

  const jobs = state.jobs.filter(j => {
    const hay = [
      j.title,
      j.company,
      j.companyName,
      j.location,
      j.description,
      j.skills,
      j.source,
      j.employment_type,
      j.experience,
      j.experienceText
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const jobSource = normalizeSource(j);

    return (
      (!q || hay.includes(q)) &&
      (!source || jobSource === source) &&
      (!loc || j.location === loc) &&
      (!type || j.employment_type === type) &&
      (!exp || j.experience === exp)
    );
  });

  jobs.sort((a, b) => {
    if (sort === 'company') {
      return String(a.company || '')
        .localeCompare(String(b.company || ''));
    }

    if (sort === 'title') {
      return String(a.title || '')
        .localeCompare(String(b.title || ''));
    }

    if (sort === 'newest') {
      const da = parseJobDate(getDateValue(a));
      const db = parseJobDate(getDateValue(b));

      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;

      return db - da;
    }

    /*
     * Default = match score.
     */
    return (
      Number(b.match_score || 0) -
      Number(a.match_score || 0)
    );
  });

  return jobs;
}


/* =========================================================
   RENDER
   ========================================================= */

function render() {
  const jobs = filteredJobs();

  $('count').textContent =
    `Showing ${jobs.length} of ${state.jobs.length} ` +
    `matched job${state.jobs.length === 1 ? '' : 's'}`;

  renderChips();

  $('jobs').innerHTML =
    jobs.map((j, i) => card(j, i)).join('');

  $('empty').classList.toggle(
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

  if ($('search')?.value.trim()) {
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

  if ($('location')?.value) {
    chips.push([
      'Location',
      $('location').value,
      'location'
    ]);
  }

  if ($('employment')?.value) {
    chips.push([
      'Job type',
      $('employment').value,
      'employment'
    ]);
  }

  if ($('experience')?.value) {
    chips.push([
      'Experience',
      $('experience').value,
      'experience'
    ]);
  }

  $('chips').innerHTML = chips
    .map(
      ([label, val, key]) =>
        `<span class="chip">
          ${escapeHtml(label)}: ${escapeHtml(val)}
          <button
            data-clear="${escapeHtml(key)}"
            aria-label="Remove ${escapeHtml(label)} filter"
          >×</button>
        </span>`
    )
    .join('');
}


/* =========================================================
   LOGO
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
  const skills = arr(j.skills).slice(0, 6);

  const exp =
    j.experience ||
    j.experienceText ||
    '';

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

  const score = Math.max(
    0,
    Math.min(
      100,
      Number(j.match_score || 0)
    )
  );

  const source = normalizeSource(j);

  const id =
    getJobId(j) ||
    getJobUrl(j) ||
    `${j.title || 'job'}-${company}-${location}`;

  const saved =
    state.saved.has(String(id));

  const desc =
    strip(
      j.description ||
      j.job_description ||
      j.jobDescription ||
      ''
    );

  const posted =
    getDateValue(j)
      ? formatPosted(getDateValue(j))
      : 'Date not listed';

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
          skills.length
            ? `
              <div class="skills">
                ${skills
                  .map(
                    (s, n) =>
                      `<span class="tag${n > 3 ? ' neutral' : ''}">
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

        <div class="job-source">
          ${escapeHtml(source)}
        </div>

        <button
          class="bookmark ${saved ? 'saved' : ''}"
          data-save="${escapeHtml(String(id))}"
          title="${saved ? 'Remove saved job' : 'Save job'}"
          aria-label="${saved ? 'Remove saved job' : 'Save job'}"
        >
          ${saved ? '★' : '☆'}
        </button>

        <a
          class="view"
          href="${escapeHtml(
            getJobUrl(j) || '#'
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
  const d = parseJobDate(value);

  if (!d) {
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
  const m = state.meta || {};

  const allSources = uniqueSources();

  const matched = state.jobs.length;

  const uniqueIds = new Set(
    state.jobs.map(j =>
      getDuplicateKey(j)
    )
  );

  const sourceText =
    allSources.length
      ? allSources.join(' + ')
      : 'No source';

  const sourceForStatus =
    allSources.length === 1
      ? allSources[0]
      : allSources.length > 1
        ? 'Multiple sources'
        : 'No source';

  const cards = [
    [
      '▣',
      'Jobs Collected',
      matched,
      'After 3-month filter'
    ],
    [
      '▤',
      'Unique Jobs',
      uniqueIds.size,
      'After deduplication'
    ],
    [
      '✦',
      'Recent Jobs',
      matched,
      'Posted in last 3 months'
    ],
    [
      '☆',
      'Matched Jobs',
      matched,
      'Available jobs'
    ],
    [
      '◎',
      'Source Status',
      sourceForStatus,
      sourceText
    ]
  ];

  $('stats').innerHTML =
    cards
      .map((c, i) =>
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

  /*
   * Header source status.
   */
  if ($('sourceName')) {
    $('sourceName').textContent =
      sourceText;
  }

  /*
   * Last updated timestamp.
   */
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
      'Last updated: ' + formatted;
  }
}


/* =========================================================
   CLEAR FILTERS
   ========================================================= */

function clearFilters() {
  if ($('search')) $('search').value = '';
  if ($('source')) $('source').value = '';
  if ($('location')) $('location').value = '';
  if ($('employment')) $('employment').value = '';
  if ($('experience')) $('experience').value = '';
  if ($('sort')) $('sort').value = 'score';

  render();
}


/* =========================================================
   EVENTS
   ========================================================= */

if ($('search')) {
  $('search').addEventListener(
    'input',
    render
  );
}

[
  'source',
  'location',
  'employment',
  'experience',
  'sort'
].forEach(id => {
  if ($(id)) {
    $(id).addEventListener(
      'change',
      render
    );
  }
});

if ($('clear')) {
  $('clear').addEventListener(
    'click',
    clearFilters
  );
}

if ($('emptyClear')) {
  $('emptyClear').addEventListener(
    'click',
    clearFilters
  );
}

if ($('refresh')) {
  $('refresh').addEventListener(
    'click',
    () => load()
  );
}

if ($('runSearch')) {
  $('runSearch').addEventListener(
    'click',
    () => load()
  );
}


/* =========================================================
   FILTER CHIP EVENTS
   ========================================================= */

if ($('chips')) {
  $('chips').addEventListener(
    'click',
    e => {
      const key =
        e.target.dataset.clear;

      if (!key) return;

      if (key === 'search') {
        $('search').value = '';
      } else if ($(key)) {
        $(key).value = '';
      }

      render();
    }
  );
}


/* =========================================================
   SAVE JOB EVENTS
   ========================================================= */

if ($('jobs')) {
  $('jobs').addEventListener(
    'click',
    e => {
      const btn =
        e.target.closest('[data-save]');

      if (!btn) return;

      const id =
        String(btn.dataset.save);

      if (state.saved.has(id)) {
        state.saved.delete(id);
      } else {
        state.saved.add(id);
      }

      localStorage.setItem(
        'job-agent-saved',
        JSON.stringify([
          ...state.saved
        ])
      );

      render();
    }
  );
}


/* =========================================================
   START
   ========================================================= */

load();
