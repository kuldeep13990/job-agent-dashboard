const PAGE_SIZES = [10, 20, 50];

const state = {
  jobs: [],
  meta: {},
  page: 1,
  pageSize: (() => {
    const saved = Number(localStorage.getItem('job-agent-page-size'));
    return PAGE_SIZES.includes(saved) ? saved : 10;
  })(),
  expanded: new Set(),
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

/*
  ============================================================
  PROFILE / MATCHING
  ============================================================
*/

const DEFAULT_PROFILE = {
  skills: [
    'Flutter',
    'Dart',
    'Android',
    'iOS',
    'Mobile Application Development',
    'Firebase',
    'REST API',
    'REST APIs',
    'API',
    'Git',
    'GitHub',
    'Bloc',
    'Provider',
    'Riverpod',
    'State Management',
    'Clean Architecture',
    'MVVM',
    'MVC',
    'Kotlin',
    'Swift',
    'Java',
    'React Native'
  ],
  titles: [
    'Flutter Developer',
    'Senior Flutter Developer',
    'Mobile App Developer',
    'Mobile Application Developer',
    'Mobile Developer',
    'Android Developer',
    'iOS Developer',
    'React Native Developer'
  ]
};

function getProfile() {
  /*
    If Resume Profile stores a profile in localStorage, use it.
    Otherwise use the default Flutter/mobile profile.
  */

  const possibleKeys = [
    'job-agent-profile',
    'job-agent-resume-profile',
    'resume-profile',
    'resumeProfile'
  ];

  for (const key of possibleKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') continue;

      const skills = arr(
        parsed.skills ||
        parsed.skill ||
        parsed.technicalSkills ||
        parsed.technical_skills
      );

      const titles = arr(
        parsed.titles ||
        parsed.targetTitles ||
        parsed.target_titles ||
        parsed.jobTitles ||
        parsed.job_titles
      );

      if (skills.length || titles.length) {
        return {
          skills: skills.length ? skills : DEFAULT_PROFILE.skills,
          titles: titles.length ? titles : DEFAULT_PROFILE.titles
        };
      }
    } catch (_) {}
  }

  return DEFAULT_PROFILE;
}

function normalizeText(value) {
  return strip(value)
    .toLowerCase()
    .replace(/[^\w+#.\-/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jobText(job) {
  return normalizeText([
    job.title,
    job.company,
    job.description,
    ...(Array.isArray(job.skills) ? job.skills : [])
  ].join(' '));
}

function calculateMatch(job) {
  const profile = getProfile();

  const title = normalizeText(job.title);
  const text = jobText(job);

  if (!text) return 0;

  const profileSkills = profile.skills
    .map(normalizeText)
    .filter(Boolean);

  const profileTitles = profile.titles
    .map(normalizeText)
    .filter(Boolean);

  let skillMatches = 0;

  for (const skill of profileSkills) {
    if (text.includes(skill)) {
      skillMatches++;
    }
  }

  const skillScore = profileSkills.length
    ? skillMatches / profileSkills.length
    : 0;

  let titleScore = 0;

  for (const targetTitle of profileTitles) {
    if (
      title.includes(targetTitle) ||
      targetTitle.includes(title)
    ) {
      titleScore = 1;
      break;
    }
  }

  /*
    Give title relevance more weight, then technical skills.
    This produces a useful percentage without requiring a
    backend match_score field.
  */

  let score =
    titleScore * 45 +
    skillScore * 55;

  /*
    Bonus for especially strong direct matches.
  */

  if (
    title.includes('flutter') &&
    (
      text.includes('dart') ||
      text.includes('flutter')
    )
  ) {
    score += 5;
  }

  if (
    title.includes('mobile') &&
    (
      text.includes('android') ||
      text.includes('ios')
    )
  ) {
    score += 3;
  }

  return Math.min(100, Math.round(score));
}

/*
  ============================================================
  SOURCES / DATE PARSING / FIELD INFERENCE
  ============================================================
*/

/*
  Every source the dashboard knows about. They always appear in
  the "All Sources" dropdown, even when a source returned 0 jobs
  in the last run (otherwise a failing source silently vanishes).
*/
const KNOWN_SOURCES = ['Adzuna', 'Naukri'];

function canonicalSource(value, url) {
  const text = String(value || '').trim().toLowerCase();
  const link = String(url || '').toLowerCase();

  for (const name of KNOWN_SOURCES) {
    const key = name.toLowerCase();
    if (text.includes(key)) return name;
  }

  if (!text) {
    for (const name of KNOWN_SOURCES) {
      if (link.includes(name.toLowerCase())) return name;
    }
    return 'Unknown';
  }

  return String(value).trim();
}

/*
  Accepts ISO strings, epoch seconds/milliseconds and relative
  text such as "3 days ago", "30+ days ago", "Just now".
  Returns a Date or null.
*/
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();

  if (/^\d{10,13}$/.test(raw)) {
    let n = Number(raw);
    if (n < 1e12) n *= 1000;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const text = raw.toLowerCase();

  if (/^(just now|today|few (seconds|minutes|hours) ago)/.test(text)) {
    return new Date();
  }

  if (text.startsWith('yesterday')) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }

  const rel = text.match(
    /(\d+)\+?\s*(minute|min|hour|hr|day|week|month|year)s?\s*ago/
  );

  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const d = new Date();

    if (unit === 'minute' || unit === 'min') d.setMinutes(d.getMinutes() - n);
    else if (unit === 'hour' || unit === 'hr') d.setHours(d.getHours() - n);
    else if (unit === 'day') d.setDate(d.getDate() - n);
    else if (unit === 'week') d.setDate(d.getDate() - n * 7);
    else if (unit === 'month') d.setMonth(d.getMonth() - n);
    else if (unit === 'year') d.setFullYear(d.getFullYear() - n);

    return d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/*
  Experience filter ranges. Every job (Adzuna or Naukri) is put in
  one of these, based on the minimum years asked for. The card still
  shows the original text (e.g. "2-5 Yrs").
*/
function bucketYears(low) {
  if (low <= 2) return '0-2 years';
  if (low <= 5) return '3-5 years';
  if (low <= 9) return '6-9 years';
  return '10+ years';
}

function experienceBucket(minYears, text) {
  if (
    minYears !== null &&
    minYears !== undefined &&
    minYears !== '' &&
    Number.isFinite(Number(minYears))
  ) {
    return bucketYears(Number(minYears));
  }

  const m = String(text || '').match(/(\d{1,2})/);

  return m ? bucketYears(Number(m[1])) : '';
}

/*
  Adzuna does not return experience or employment type, so the
  two filters would always be empty. Derive them from the text
  when the source did not provide a value.
*/

function inferExperience(text) {
  const t = String(text || '');
  const re =
    /(\d{1,2})\s*(?:\+|(?:-|–|to)\s*(\d{1,2}))?\s*(?:years?|yrs?)\b/gi;

  let m;

  while ((m = re.exec(t))) {
    const low = Number(m[1]);
    const high = m[2] ? Number(m[2]) : null;

    if (low > 30) continue;
    if (high !== null && (high < low || high > 40)) continue;

    const context = t
      .slice(
        Math.max(0, m.index - 60),
        m.index + m[0].length + 60
      )
      .toLowerCase();

    if (!/experience|\bexp\b/.test(context)) continue;

    /*
      Group by the minimum years asked for, so the dropdown
      has a handful of usable ranges instead of dozens.
    */
    return bucketYears(low);
  }

  return '';
}

function inferEmploymentType(title, text) {
  const t = String(title || '').toLowerCase();
  const d = String(text || '').toLowerCase();

  if (/\bintern(ship)?s?\b/.test(t) || /\binternship\b/.test(d)) {
    return 'Internship';
  }

  if (/part[\s-]?time/.test(t + ' ' + d)) return 'Part-time';

  if (
    /\b(contract|contractual|freelance|fixed[\s-]term)\s+(basis|position|role|job|employment|opportunity)/.test(d) ||
    /contract[\s-]to[\s-]hire|\bcontractor\b/.test(t + ' ' + d)
  ) {
    return 'Contract';
  }

  if (/full[\s-]?time/.test(t + ' ' + d)) return 'Full-time';

  return '';
}

/*
  ============================================================
  NORMALIZATION
  ============================================================
*/

function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const title = String(
    raw.title ||
    raw.jobTitle ||
    ''
  ).trim();

  const company = String(
    raw.company ||
    raw.companyName ||
    raw.company_name ||
    ''
  ).trim();

  const location = String(
    raw.location ||
    raw.jobLocation ||
    ''
  ).trim();

  const description = strip(
    raw.description ||
    raw.jobDescription ||
    raw.job_description ||
    ''
  );

  const skills = arr(
    raw.skills ||
    raw.skill ||
    raw.tagsAndSkills
  );

  const url =
    raw.original_url ||
    raw.originalUrl ||
    raw.jobUrl ||
    raw.job_url ||
    raw.jdURL ||
    raw.redirect_url ||
    raw.redirectUrl ||
    '#';

  const source = canonicalSource(
    raw.source || raw.Source,
    url
  );

  /*
    Use the value from the source when present, otherwise
    derive it from the job text so the filters have options.
  */
  const experience =
    String(
      raw.experience ||
      raw.experienceText ||
      raw.experience_text ||
      ''
    ).trim() ||
    inferExperience(`${title} ${description}`);

  const employmentType =
    String(
      raw.employment_type ||
      raw.employmentType ||
      raw.jobType ||
      raw.job_type ||
      ''
    ).trim() ||
    inferEmploymentType(title, description);

  const postedDate = parseDate(
    raw.posted_at ||
    raw.postedDate ||
    raw.posted_date ||
    raw.createdDate ||
    raw.created ||
    ''
  );

  const postedAt = postedDate ? postedDate.toISOString() : '';

  const id =
    raw.id ||
    raw.jobId ||
    raw.job_id ||
    raw.original_url ||
    raw.jobUrl ||
    `${title}|${company}|${location}`;

  const companyLogo =
    raw.companyLogoUrl ||
    raw.company_logo ||
    raw.companyLogo ||
    '';

  const normalized = {
    ...raw,

    source,
    id: String(id),
    job_id: raw.job_id || raw.jobId || '',
    title,
    company,
    company_name: company,
    company_logo: companyLogo,
    location,
    experience,
    experience_bucket: experienceBucket(
      raw.experience_min ?? raw.experienceMin ?? null,
      experience
    ),
    experience_min:
      raw.experience_min ??
      raw.experienceMin ??
      null,
    experience_max:
      raw.experience_max ??
      raw.experienceMax ??
      null,
    skills,
    description,
    employment_type: employmentType,
    posted_at: postedAt,
    original_url: url,
    redirect_url: url,
    match_score: calculateMatch({
      title,
      company,
      description,
      skills
    })
  };

  return normalized;
}

/*
  ============================================================
  DATE FILTER
  ============================================================
*/

function isWithinLastThreeMonths(job) {
  /*
    Jobs with no usable date are kept (shown as "Date not listed")
    instead of being silently dropped.
  */
  if (!job.posted_at) return true;

  const date = new Date(job.posted_at);

  if (Number.isNaN(date.getTime())) return true;

  const now = new Date();
  now.setDate(now.getDate() + 1); // allow timezone skew

  /*
    Calendar-based 3 months, rather than simply 90 days.
  */

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 3);

  return date >= cutoff && date <= now;
}

/*
  ============================================================
  DUPLICATE REMOVAL
  ============================================================
*/

function duplicateKey(job) {
  const source = normalizeText(job.source);

  const id = normalizeText(
    job.job_id ||
    job.id ||
    ''
  );

  if (id) {
    return `${source}|id|${id}`;
  }

  const url = normalizeText(
    job.original_url ||
    job.redirect_url ||
    ''
  );

  if (url) {
    return `${source}|url|${url}`;
  }

  return [
    source,
    normalizeText(job.title),
    normalizeText(job.company),
    normalizeText(job.location)
  ].join('|');
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const result = [];

  for (const job of jobs) {
    const key = duplicateKey(job);

    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(job);
  }

  return result;
}

/*
  ============================================================
  LOAD DATA
  ============================================================
*/

function normalizePayload(payload) {
  const rawJobs = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.jobs)
      ? payload.jobs
      : [];

  const normalized = rawJobs
    .map(normalizeJob)
    .filter(Boolean);

  /*
    First remove jobs older than 3 months.
  */

  const recent = normalized.filter(isWithinLastThreeMonths);

  /*
    Then remove duplicates.
  */

  state.jobs = dedupeJobs(recent);

  state.meta = payload?.meta || {};

  /*
    Recalculate match score after normalization.
  */

  state.jobs.forEach(job => {
    job.match_score = calculateMatch(job);
  });
}

async function load() {
  $('jobs').innerHTML = `
    <div class="empty">
      <div class="empty-icon">↻</div>
      <h2>Loading jobs…</h2>
      <p>Fetching the latest dashboard data.</p>
    </div>
  `;

  try {
    const response = await fetch(
      'data/jobs.json?ts=' + Date.now(),
      {
        cache: 'no-store'
      }
    );

    if (!response.ok) {
      throw new Error('data unavailable');
    }

    const payload = await response.json();

    normalizePayload(payload);

    state.page = 1;

    renderFilters();
    render();

  } catch (error) {
    console.error(error);

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

/*
  ============================================================
  FILTER HELPERS
  ============================================================
*/

function unique(key) {
  return [
    ...new Set(
      state.jobs
        .map(job => job[key])
        .filter(Boolean)
        .map(String)
    )
  ].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
}

/*
  Source options = known sources + sources listed in meta +
  sources found in the jobs, each with its job count.
*/
function sourceCounts() {
  const counts = {};

  KNOWN_SOURCES.forEach(name => {
    counts[name] = 0;
  });

  Object.keys(state.meta?.sources || {}).forEach(name => {
    counts[canonicalSource(name)] ??= 0;
  });

  state.jobs.forEach(job => {
    counts[job.source] = (counts[job.source] || 0) + 1;
  });

  return counts;
}

function sourceOptions() {
  const counts = sourceCounts();

  return Object.keys(counts)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      value: name,
      label: `${name} (${counts[name]})`
    }));
}

/*
  values: array of strings or { value, label } objects.
  A filter with no options is disabled instead of looking broken.
*/
function populate(id, values) {
  const el = $(id);

  if (!el) return;

  const current = el.value;

  const items = values.map(v =>
    typeof v === 'object' && v !== null
      ? v
      : { value: String(v), label: String(v) }
  );

  while (el.options.length > 1) {
    el.remove(1);
  }

  items.forEach(item => {
    const option = document.createElement('option');

    option.value = item.value;
    option.textContent = item.label;

    el.appendChild(option);
  });

  if (items.some(item => item.value === current)) {
    el.value = current;
  } else {
    el.selectedIndex = 0;
  }

  const empty = items.length === 0;

  el.disabled = empty;
  el.title = empty
    ? 'No values available in the current job data'
    : '';
}

/*
  Ensure source filter exists even if the HTML version is old.
  The Source filter is created as a sibling of the search box
  (never inside it), by cloning an existing filter box.
*/

function ensureSourceFilter() {
  let source = $('source');
  if (source) return source;

  const search = $('search');
  const reference =
    $('location') ||
    $('employment') ||
    $('experience');

  if (!search || !reference) return null;

  /*
    Find the outer box of the search field: the direct child
    of the row that also contains the reference filter.
  */
  let searchBox = search;
  while (
    searchBox.parentElement &&
    !searchBox.parentElement.contains(reference)
  ) {
    searchBox = searchBox.parentElement;
  }

  const row = searchBox.parentElement;
  if (!row) return null;

  let refBox = reference;
  while (refBox.parentElement && refBox.parentElement !== row) {
    refBox = refBox.parentElement;
  }

  /*
    Clone a working filter box (icon + border + select) so the
    Source filter looks exactly like the others.
  */
  const box = refBox.cloneNode(true);

  source = box.matches('select')
    ? box
    : box.querySelector('select');

  if (!source) return null;

  source.id = 'source';
  source.setAttribute('aria-label', 'Job source');
  source.innerHTML = '<option value="">All Sources</option>';
  source.value = '';

  row.insertBefore(box, searchBox.nextSibling);

  source.addEventListener('change', applyFilters);

  return source;
}

/*
  ============================================================
  FILTER LAYOUT
  Search bar = full width (first line)
  Source / Location / Job Type / Experience / Sort / Clear
  = second line, below the search bar
  ============================================================
*/

function injectFilterStyles() {
  if ($('filter-layout-styles')) return;

  const style = document.createElement('style');
  style.id = 'filter-layout-styles';

  style.textContent = `
    .filter-row-stacked {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      flex-wrap: nowrap !important;
      gap: 12px !important;
    }

    .filter-search-full {
      width: 100% !important;
      max-width: none !important;
      min-width: 0 !important;
      flex: none !important;
      box-sizing: border-box !important;
    }

    .filter-controls {
      display: grid;
      grid-template-columns:
        repeat(4, minmax(0, 1fr))
        minmax(0, 1.25fr)
        minmax(0, 0.7fr);
      gap: 12px;
      width: 100%;
    }

    .filter-controls > * {
      width: auto !important;
      min-width: 0 !important;
      max-width: none !important;
      flex: none !important;
      margin: 0 !important;
      box-sizing: border-box !important;
    }

    .filter-controls select,
    .filter-controls input {
      min-width: 0 !important;
      max-width: 100% !important;
      text-overflow: ellipsis;
    }

    .filter-controls select:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    @media (max-width: 1250px) {
      .filter-controls {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .filter-controls {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 480px) {
      .filter-controls {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;

  document.head.appendChild(style);
}

function layoutFilters() {
  const search = $('search');
  const reference =
    $('location') ||
    $('employment') ||
    $('experience');

  if (!search || !reference) return;

  injectFilterStyles();

  /*
    Outer box of the search field (direct child of the filter row).
  */
  let searchBox = search;
  while (
    searchBox.parentElement &&
    !searchBox.parentElement.contains(reference)
  ) {
    searchBox = searchBox.parentElement;
  }

  const row = searchBox.parentElement;
  if (!row) return;

  /*
    Already rearranged: nothing to do.
  */
  if (row.dataset.layout === 'stacked') return;

  const controls = document.createElement('div');
  controls.className = 'filter-controls';

  ['source', 'location', 'employment', 'experience', 'sort', 'clear']
    .forEach(id => {
      const el = $(id);
      if (!el) return;

      let box = el;
      while (box.parentElement && box.parentElement !== row) {
        box = box.parentElement;
      }

      if (box.parentElement === row && box !== searchBox) {
        controls.appendChild(box);
      }
    });

  searchBox.classList.add('filter-search-full');
  row.classList.add('filter-row-stacked');
  row.dataset.layout = 'stacked';

  row.appendChild(controls);
}

function renderFilters() {
  const source = ensureSourceFilter();

  if (source) {
    populate(
      'source',
      sourceOptions()
    );
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
    unique('experience_bucket')
  );

  /*
    Search on its own full-width line, all other filters below.
  */
  layoutFilters();
}

/*
  ============================================================
  FILTERING
  ============================================================
*/

function filteredJobs() {
  const q =
    $('search')?.value
      .toLowerCase()
      .trim() || '';

  const source =
    $('source')?.value || '';

  const location =
    $('location')?.value || '';

  const type =
    $('employment')?.value || '';

  const experience =
    $('experience')?.value || '';

  const sort =
    $('sort')?.value || 'score';

  const jobs = state.jobs.filter(job => {
    const haystack = [
      job.title,
      job.company,
      job.location,
      job.description,
      ...(Array.isArray(job.skills) ? job.skills : []),
      job.source,
      job.employment_type,
      job.experience
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return (
      (!q || haystack.includes(q)) &&
      (!source || job.source === source) &&
      (!location || job.location === location) &&
      (!type || job.employment_type === type) &&
      (!experience || job.experience_bucket === experience)
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
      return (
        new Date(b.posted_at || 0) -
        new Date(a.posted_at || 0)
      );
    }

    if (sort === 'oldest') {
      return (
        new Date(a.posted_at || 0) -
        new Date(b.posted_at || 0)
      );
    }

    /*
      Default = match score.
    */

    return (
      Number(b.match_score || 0) -
      Number(a.match_score || 0)
    );
  });

  return jobs;
}

/*
  ============================================================
  FILTER CHIPS
  ============================================================
*/

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
    .map(([label, value, key]) => `
      <span class="chip">
        ${escapeHtml(label)}:
        ${escapeHtml(value)}
        <button
          data-clear="${escapeHtml(key)}"
          aria-label="Remove ${escapeHtml(label)} filter"
        >×</button>
      </span>
    `)
    .join('');
}

/*
  ============================================================
  JOB CARD
  ============================================================
*/

function logoFor(job) {
  const company =
    String(job.company || 'Company').trim();

  return escapeHtml(
    (company[0] || 'C').toUpperCase()
  );
}

function card(job, index) {
  const skills =
    arr(job.skills).slice(0, 6);

  const experience =
    job.experience || '';

  const type =
    job.employment_type || 'Type not listed';

  const location =
    job.location || 'Location not listed';

  const company =
    job.company || 'Company not listed';

  const score =
    Number(job.match_score || 0);

  const id =
    job.id ||
    job.job_id ||
    job.original_url ||
    `${job.title || 'job'}-${company}`;

  const saved =
    state.saved.has(String(id));

  const description =
    strip(job.description);

  const salary =
    formatSalary(job);

  const expanded =
    state.expanded.has(String(id));

  const sourceClass =
    'source-' + String(job.source || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  const posted =
    job.posted_at
      ? formatPosted(job.posted_at)
      : 'Date not listed';

  return `
    <article class="job">

      <div class="company-logo alt${index % 5}">
        ${logoFor(job)}
      </div>

      <div class="job-main">

        <div class="job-title-row">
          <h2 class="job-title">
            ${escapeHtml(job.title || 'Untitled role')}
          </h2>

          <span class="score">
            ${score}% Match
          </span>

          <span class="source-badge ${escapeHtml(sourceClass)}">
            ${escapeHtml(job.source || 'Unknown')}
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
              experience || 'Experience not listed'
            )}
          </span>

          ${
            salary
              ? `
                <span class="meta-item">
                  <span class="meta-icon">₹</span>
                  ${escapeHtml(salary)}
                </span>
              `
              : ''
          }

          <span class="meta-item">
            <span class="meta-icon">♧</span>
            ${escapeHtml(
              job.company_size ||
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
                    (skill, n) => `
                      <span class="tag${n > 3 ? ' neutral' : ''}">
                        ${escapeHtml(skill)}
                      </span>
                    `
                  )
                  .join('')}
              </div>
            `
            : ''
        }

        ${
          description
            ? `
              <div class="description-wrap">
                <div class="description${expanded ? '' : ' is-clamped'}">
                  ${escapeHtml(description)}
                </div>

                <button
                  type="button"
                  class="read-more"
                  data-toggle="${escapeHtml(String(id))}"
                  aria-expanded="${expanded}"
                  ${expanded ? '' : 'hidden'}
                >
                  <span class="rm-label">${expanded ? 'Show less' : 'Read more'}</span>
                  <span class="rm-icon" aria-hidden="true">${expanded ? '⌃' : '⌄'}</span>
                </button>
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
          data-save="${escapeHtml(String(id))}"
          title="${saved ? 'Remove saved job' : 'Save job'}"
          aria-label="${saved ? 'Remove saved job' : 'Save job'}"
        >
          ${saved ? '★' : '☆'}
        </button>

        <a
          class="view"
          href="${escapeHtml(
            job.original_url ||
            job.redirect_url ||
            '#'
          )}"
          target="_blank"
          rel="noopener noreferrer"
        >
          View Job ↗
        </a>

      </div>

    </article>
  `;
}

/*
  ============================================================
  DATE FORMAT
  ============================================================
*/

function formatPosted(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Date not listed';
  }

  return date.toLocaleDateString(
    undefined,
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }
  );
}

/*
  ============================================================
  STATS
  ============================================================
*/

function renderStats() {
  const meta = state.meta;

  const sources = sourceCounts();

  const sourceNames =
    Object.keys(sources).sort((a, b) => a.localeCompare(b));

  const total =
    state.jobs.length;

  const uniqueIds =
    new Set(
      state.jobs.map(
        job =>
          job.id ||
          job.job_id ||
          job.original_url ||
          `${job.title}-${job.company}`
      )
    );

  const averageMatch =
    total
      ? Math.round(
          state.jobs.reduce(
            (sum, job) =>
              sum +
              Number(job.match_score || 0),
            0
          ) / total
        )
      : 0;

  /*
    If one source is selected, show that source.
    Otherwise show all sources.
  */

  const selectedSource =
    $('source')?.value || '';

  const sourceLabel =
    selectedSource ||
    (
      sourceNames.length
        ? sourceNames.join(' + ')
        : 'No source'
    );

  /*
    A source that returned 0 jobs is flagged instead of "Enabled".
  */
  const emptySources = (
    selectedSource ? [selectedSource] : sourceNames
  ).filter(name => !sources[name]);

  const statusText = emptySources.length
    ? `${emptySources.join(', ')}: no jobs`
    : 'Enabled';

  const statusStyle = emptySources.length
    ? ' style="background:#fff4e5;color:#b45309"'
    : '';

  const cards = [
    [
      '▣',
      'Jobs Collected',
      total,
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
      total,
      'Posted in last 3 months'
    ],

    [
      '☆',
      'Matched Jobs',
      total,
      `Average match ${averageMatch}%`
    ],

    [
      '◎',
      'Source Status',
      sourceLabel,
      sourceNames.length
        ? sourceNames
            .map(name =>
              `${name}: ${sources[name]}`
            )
            .join(' • ')
        : 'No jobs available'
    ]
  ];

  $('stats').innerHTML =
    cards
      .map((card, index) => {
        if (index === 4) {
          return `
            <div class="stat">

              <div class="stat-icon">
                ${card[0]}
              </div>

              <div class="stat-copy">

                <div class="stat-label">
                  ${card[1]}
                </div>

                <div class="source-status">
                  <span class="mini-dot"></span>

                  ${escapeHtml(card[2])}

                  <span class="enabled"${statusStyle}>
                    ${escapeHtml(statusText)}
                  </span>
                </div>

                <div class="stat-sub">
                  ${escapeHtml(card[3])}
                </div>

              </div>

            </div>
          `;
        }

        return `
          <div class="stat">

            <div class="stat-icon">
              ${card[0]}
            </div>

            <div class="stat-copy">

              <div class="stat-label">
                ${card[1]}
              </div>

              <div class="stat-value">
                ${escapeHtml(card[2])}
              </div>

              <div class="stat-sub">
                ${escapeHtml(card[3])}
              </div>

            </div>

          </div>
        `;
      })
      .join('');

  /*
    Header source status.
  */

  if ($('sourceName')) {
    $('sourceName').textContent =
      sourceLabel;
  }

  const raw =
    meta.last_run_utc ||
    meta.updated_at ||
    meta.updated_at_utc;

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

/*
  ============================================================
  SALARY
  ============================================================
*/

function lakhs(n) {
  return String(Math.round((n / 100000) * 10) / 10)
    .replace(/\.0$/, '');
}

/*
  Returns e.g. "₹7-14 LPA", or '' when the job has no usable salary.
*/
function formatSalary(job) {
  const min = Number(job.salary_min);
  const max = Number(job.salary_max);

  const hasMin = Number.isFinite(min) && min >= 10000;
  const hasMax = Number.isFinite(max) && max >= 10000;

  if (hasMin || hasMax) {
    const low = lakhs(hasMin ? min : max);
    const high = lakhs(hasMax ? max : min);

    return low === high
      ? `₹${low} LPA`
      : `₹${low}-${high} LPA`;
  }

  const m = String(job.salary || '').match(
    /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*lacs?/i
  );

  if (m && (Number(m[1]) > 0 || Number(m[2]) > 0)) {
    return m[1] === m[2]
      ? `₹${m[1]} LPA`
      : `₹${m[1]}-${m[2]} LPA`;
  }

  return '';
}

/*
  ============================================================
  UI STYLES: source badge, read more, pagination
  ============================================================
*/

function injectUiStyles() {
  if ($('ui-extra-styles')) return;

  const style = document.createElement('style');
  style.id = 'ui-extra-styles';

  style.textContent = `
    .job-title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 10px;
    }

    .source-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
      background: #eef1f6;
      color: #475569;
    }

    .source-badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .source-badge.source-naukri {
      background: #fff1e6;
      color: #c2410c;
    }

    .source-badge.source-adzuna {
      background: #e8f0ff;
      color: #1d4ed8;
    }

    .description.is-clamped {
      display: -webkit-box !important;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 5;
      overflow: hidden;
    }

    .read-more {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #2563eb;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .read-more:hover {
      text-decoration: underline;
    }

    .read-more[hidden] {
      display: none !important;
    }

    .pagination {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px 16px;
      margin: 20px 0 8px;
    }

    .pg-info,
    .pg-size {
      font-size: 13px;
      color: #64748b;
    }

    .pg-size select {
      margin-left: 6px;
      padding: 6px 8px;
      border: 1px solid #dfe5ee;
      border-radius: 8px;
      background: #fff;
      font: inherit;
      color: inherit;
    }

    .pg-buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .pg-btn {
      min-width: 38px;
      height: 38px;
      padding: 0 12px;
      border: 1px solid #dfe5ee;
      border-radius: 10px;
      background: #fff;
      font: inherit;
      font-size: 14px;
      color: #1e293b;
      cursor: pointer;
    }

    .pg-btn:hover:not(:disabled):not(.active) {
      background: #f1f5f9;
    }

    .pg-btn.active {
      background: #2563eb;
      border-color: #2563eb;
      color: #fff;
      font-weight: 600;
      cursor: default;
    }

    .pg-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .pg-gap {
      padding: 0 4px;
      color: #94a3b8;
    }
  `;

  document.head.appendChild(style);
}

/*
  ============================================================
  READ MORE / SHOW LESS
  The button only appears when the text really is longer than
  5 lines. Expanded jobs stay expanded after re-render.
  ============================================================
*/

function initReadMore() {
  document
    .querySelectorAll('#jobs .description.is-clamped')
    .forEach(el => {
      const button =
        el.parentElement?.querySelector('.read-more');

      if (!button) return;

      button.hidden =
        !(el.scrollHeight > el.clientHeight + 1);
    });
}

function toggleDescription(button) {
  const id = String(button.dataset.toggle);
  const open = !state.expanded.has(id);

  if (open) {
    state.expanded.add(id);
  } else {
    state.expanded.delete(id);
  }

  const desc =
    button.parentElement.querySelector('.description');

  if (desc) desc.classList.toggle('is-clamped', !open);

  button.setAttribute('aria-expanded', String(open));
  button.querySelector('.rm-label').textContent =
    open ? 'Show less' : 'Read more';
  button.querySelector('.rm-icon').textContent =
    open ? '⌃' : '⌄';

  /*
    A collapsed card always keeps its button visible so the
    user can expand it again after "Show less".
  */
  button.hidden = false;
}

/*
  ============================================================
  PAGINATION
  ============================================================
*/

function ensurePagination() {
  let nav = $('pagination');

  if (nav) return nav;

  const list = $('jobs');

  if (!list) return null;

  nav = document.createElement('nav');
  nav.id = 'pagination';
  nav.className = 'pagination';
  nav.setAttribute('aria-label', 'Job pages');

  list.insertAdjacentElement('afterend', nav);

  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-page]');

    if (!button || button.disabled) return;

    goToPage(Number(button.dataset.page));
  });

  nav.addEventListener('change', event => {
    const select =
      event.target.closest('[data-page-size]');

    if (!select) return;

    state.pageSize = Number(select.value);
    localStorage.setItem(
      'job-agent-page-size',
      String(state.pageSize)
    );

    state.page = 1;
    render();
  });

  return nav;
}

/*
  1 … 4 5 6 … 20 style page list.
*/
function pageList(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  let start = Math.max(2, current - 1);
  let end = Math.min(total - 1, current + 1);

  if (current <= 3) {
    start = 2;
    end = 4;
  }

  if (current >= total - 2) {
    start = total - 3;
    end = total - 1;
  }

  const pages = [1];

  if (start > 2) pages.push('…');

  for (let i = start; i <= end; i++) pages.push(i);

  if (end < total - 1) pages.push('…');

  pages.push(total);

  return pages;
}

function renderPagination(totalItems, totalPages) {
  const nav = ensurePagination();

  if (!nav) return;

  if (!totalItems) {
    nav.innerHTML = '';
    return;
  }

  const current = state.page;

  const buttons = totalPages > 1
    ? `
      <button
        type="button"
        class="pg-btn"
        data-page="${current - 1}"
        ${current === 1 ? 'disabled' : ''}
        aria-label="Previous page"
      >‹ Prev</button>

      ${pageList(current, totalPages)
        .map(p =>
          p === '…'
            ? '<span class="pg-gap">…</span>'
            : `
              <button
                type="button"
                class="pg-btn${p === current ? ' active' : ''}"
                data-page="${p}"
                ${p === current ? 'aria-current="page"' : ''}
              >${p}</button>
            `
        )
        .join('')}

      <button
        type="button"
        class="pg-btn"
        data-page="${current + 1}"
        ${current === totalPages ? 'disabled' : ''}
        aria-label="Next page"
      >Next ›</button>
    `
    : '';

  nav.innerHTML = `
    <div class="pg-info">
      Page ${current} of ${totalPages}
    </div>

    <div class="pg-buttons">
      ${buttons}
    </div>

    <label class="pg-size">
      Per page
      <select data-page-size aria-label="Jobs per page">
        ${PAGE_SIZES
          .map(n => `
            <option value="${n}"${n === state.pageSize ? ' selected' : ''}>${n}</option>
          `)
          .join('')}
      </select>
    </label>
  `;
}

function goToPage(page) {
  if (!Number.isFinite(page)) return;

  state.page = page;
  render();

  const top = $('count') || $('jobs');

  if (top && top.scrollIntoView) {
    top.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/*
  Any search / filter / sort change starts again from page 1.
*/
function applyFilters() {
  state.page = 1;
  render();
}

/*
  ============================================================
  RENDER
  ============================================================
*/

function render() {
  const jobs =
    filteredJobs();

  const totalPages = Math.max(
    1,
    Math.ceil(jobs.length / state.pageSize)
  );

  state.page = Math.min(
    Math.max(1, state.page),
    totalPages
  );

  const startIndex =
    (state.page - 1) * state.pageSize;

  const pageJobs = jobs.slice(
    startIndex,
    startIndex + state.pageSize
  );

  $('count').textContent = jobs.length
    ? `Showing ${startIndex + 1}-${startIndex + pageJobs.length} ` +
      `of ${jobs.length} matched job${jobs.length === 1 ? '' : 's'}` +
      (
        jobs.length !== state.jobs.length
          ? ` (filtered from ${state.jobs.length})`
          : ''
      )
    : `Showing 0 of ${state.jobs.length} matched jobs`;

  renderChips();

  $('jobs').innerHTML =
    pageJobs
      .map((job, index) =>
        card(job, startIndex + index)
      )
      .join('');

  renderPagination(jobs.length, totalPages);

  if ($('empty')) {
    $('empty').classList.toggle(
      'hidden',
      jobs.length > 0
    );
  }

  renderStats();

  initReadMore();
}

/*
  ============================================================
  CLEAR FILTERS
  ============================================================
*/

function clearFilters() {
  if ($('search')) {
    $('search').value = '';
  }

  if ($('source')) {
    $('source').value = '';
  }

  if ($('location')) {
    $('location').value = '';
  }

  if ($('employment')) {
    $('employment').value = '';
  }

  if ($('experience')) {
    $('experience').value = '';
  }

  if ($('sort')) {
    $('sort').value = 'score';
  }

  applyFilters();
}

/*
  ============================================================
  EVENTS
  ============================================================
*/

if ($('search')) {
  $('search').addEventListener(
    'input',
    applyFilters
  );
}

[
  'source',
  'location',
  'employment',
  'experience',
  'sort'
].forEach(id => {
  const element = $(id);

  if (element) {
    element.addEventListener(
      'change',
      applyFilters
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
    load
  );
}

if ($('runSearch')) {
  $('runSearch').addEventListener(
    'click',
    load
  );
}

if ($('chips')) {
  $('chips').addEventListener(
    'click',
    event => {
      const key =
        event.target.dataset.clear;

      if (!key) return;

      if (key === 'search') {
        $('search').value = '';
      } else if ($(key)) {
        $(key).value = '';
      }

      applyFilters();
    }
  );
}

if ($('jobs')) {
  $('jobs').addEventListener(
    'click',
    event => {
      const toggle =
        event.target.closest(
          '[data-toggle]'
        );

      if (toggle) {
        toggleDescription(toggle);
        return;
      }

      const button =
        event.target.closest(
          '[data-save]'
        );

      if (!button) return;

      const id =
        String(button.dataset.save);

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

/*
  ============================================================
  START
  ============================================================
*/

injectUiStyles();

window.addEventListener('resize', () => {
  clearTimeout(window.__readMoreTimer);
  window.__readMoreTimer = setTimeout(initReadMore, 150);
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(initReadMore);
}

load();
