/* =========================================================
   JOB SEARCH AGENT - DASHBOARD
   Supports:
   - Naukri
   - Adzuna
   - Source filtering
   - Deduplication
   - Last 3 months filtering
   - Match score fallback
   ========================================================= */

const state = {
  jobs: [],
  meta: {},
  saved: new Set(
    JSON.parse(localStorage.getItem("job-agent-saved") || "[]") || []
  ),
  source: localStorage.getItem("job-agent-source") || "",
};

const $ = (id) => document.getElementById(id);

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[c]));

const strip = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const arr = (v) => {
  if (Array.isArray(v)) return v;

  if (typeof v === "string") {
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return [];
};

const normalizeSource = (value) => {
  const s = String(value ?? "").trim().toLowerCase();

  if (s.includes("naukri")) return "Naukri";
  if (s.includes("adzuna")) return "Adzuna";

  return value ? String(value).trim() : "Unknown";
};


/* =========================================================
   DATE HELPERS
   ========================================================= */

function getCutoffDate() {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - 3);
  return cutoff;
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();

  if (!text) return null;

  // Unix timestamp
  if (/^\d{10,13}$/.test(text)) {
    const n = Number(text);
    const ms = text.length === 10 ? n * 1000 : n;
    const d = new Date(ms);

    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(text);

  if (!Number.isNaN(d.getTime())) {
    return d;
  }

  return null;
}

function getPostedValue(j) {
  return (
    j.posted_at ||
    j.postedAt ||
    j.posted_date ||
    j.postedDate ||
    j.date ||
    j.created_at ||
    j.createdAt ||
    j.pubDate ||
    j.publication_date ||
    j.updated_at ||
    j.updatedAt ||
    null
  );
}

function isRecentJob(j) {
  const value = getPostedValue(j);
  const date = parseDate(value);

  // If there is no usable date, we cannot verify
  // that the job is within the requested 3-month window.
  if (!date) return false;

  const cutoff = getCutoffDate();

  return date >= cutoff;
}


/* =========================================================
   NORMALIZATION
   Converts Naukri + Adzuna records into one format.
   ========================================================= */

function normalizeJob(raw) {
  const j = raw || {};

  const source = normalizeSource(
    j.source ||
    j.sourceName ||
    j.portal ||
    j.provider
  );

  const title =
    j.title ||
    j.jobTitle ||
    j.position ||
    "Untitled role";

  const company =
    j.company ||
    j.companyName ||
    j.employer ||
    j.employerName ||
    "Company not listed";

  const location =
    j.location ||
    j.locationName ||
    j.city ||
    j.place ||
    "Location not listed";

  const description = strip(
    j.description ||
    j.jobDescription ||
    j.descriptionText ||
    j.details ||
    ""
  );

  const skills = arr(
    j.skills ||
    j.skill ||
    j.keySkills ||
    j.key_skills
  );

  const experience =
    j.experience ||
    j.experienceText ||
    j.experience_text ||
    j.exp ||
    "";

  const employmentType =
    j.employment_type ||
    j.employmentType ||
    j.workMode ||
    j.work_mode ||
    j.jobType ||
    j.job_type ||
    "Full-time";

  const url =
    j.original_url ||
    j.originalUrl ||
    j.redirect_url ||
    j.redirectUrl ||
    j.url ||
    j.jobUrl ||
    j.job_url ||
    "#";

  const id =
    j.id ||
    j.job_id ||
    j.jobId ||
    j.guid ||
    j.reference ||
    url ||
    `${title}-${company}-${location}`;

  const postedAt = getPostedValue(j);

  let score = Number(
    j.match_score ??
    j.matchScore ??
    j.score ??
    0
  );

  if (!Number.isFinite(score)) score = 0;

  return {
    ...j,

    id: String(id),
    source,
    title,
    company,
    location,
    description,
    skills,
    experience,
    employment_type: employmentType,
    original_url: url,
    posted_at: postedAt,
    match_score: score,

    company_size:
      j.company_size ||
      j.companySize ||
      "Company size: Unknown",
  };
}


/* =========================================================
   DEDUPLICATION
   ========================================================= */

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDedupKey(j) {
  const url = String(j.original_url || "").trim();

  if (url && url !== "#") {
    return `url:${url.toLowerCase()}`;
  }

  const source = normalizeText(j.source);
  const title = normalizeText(j.title);
  const company = normalizeText(j.company);
  const location = normalizeText(j.location);

  return `job:${source}|${title}|${company}|${location}`;
}

function deduplicateJobs(jobs) {
  const seen = new Set();
  const result = [];

  for (const job of jobs) {
    const key = getDedupKey(job);

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(job);
  }

  return result;
}


/* =========================================================
   LOAD DATA
   ========================================================= */

function normalizePayload(payload) {
  let rawJobs = [];

  if (Array.isArray(payload)) {
    rawJobs = payload;
    state.meta = {};
  } else {
    rawJobs = payload?.jobs || [];
    state.meta = payload?.meta || {};
  }

  const normalized = rawJobs
    .map(normalizeJob)
    .filter((j) => isRecentJob(j));

  state.jobs = deduplicateJobs(normalized);
}

async function load() {
  if ($("jobs")) {
    $("jobs").innerHTML = `
      <div class="empty">
        <div class="empty-icon">↻</div>
        <h2>Loading jobs…</h2>
        <p>Fetching the latest dashboard data.</p>
      </div>
    `;
  }

  try {
    const response = await fetch(
      "data/jobs.json?ts=" + Date.now(),
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("data unavailable");
    }

    const payload = await response.json();

    normalizePayload(payload);

    ensureSourceFilter();
    renderFilters();
    render();

  } catch (error) {
    console.error("Dashboard load error:", error);

    if ($("jobs")) {
      $("jobs").innerHTML = `
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
}


/* =========================================================
   SOURCE FILTER
   ========================================================= */

function ensureSourceFilter() {
  let existing = $("source");

  if (existing) {
    return;
  }

  // Try to place source filter after search box.
  const search = $("search");

  if (!search || !search.parentElement) {
    return;
  }

  const wrapper = document.createElement("div");

  wrapper.className = "filter-control";

  wrapper.innerHTML = `
    <select id="source" aria-label="Filter by source">
      <option value="">All Sources</option>
    </select>
  `;

  search.parentElement.insertAdjacentElement(
    "afterend",
    wrapper
  );
}

function populateSourceFilter() {
  const el = $("source");

  if (!el) return;

  const current = state.source;

  while (el.options.length > 1) {
    el.remove(1);
  }

  const sources = [
    ...new Set(
      state.jobs
        .map((j) => normalizeSource(j.source))
        .filter((s) => s && s !== "Unknown")
    ),
  ].sort();

  sources.forEach((source) => {
    const option = document.createElement("option");

    option.value = source;
    option.textContent = source;

    el.appendChild(option);
  });

  if (
    current &&
    sources.includes(current)
  ) {
    el.value = current;
  } else {
    el.value = "";
    state.source = "";
    localStorage.setItem("job-agent-source", "");
  }
}


/* =========================================================
   GENERIC FILTER DROPDOWNS
   ========================================================= */

function unique(key) {
  return [
    ...new Set(
      state.jobs
        .map((j) => j[key])
        .filter(Boolean)
    ),
  ].sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function populate(id, values) {
  const el = $(id);

  if (!el) return;

  const current = el.value;

  while (el.options.length > 1) {
    el.remove(1);
  }

  values.forEach((value) => {
    const option = document.createElement("option");

    option.value = value;
    option.textContent = value;

    el.appendChild(option);
  });

  if (values.includes(current)) {
    el.value = current;
  }
}

function renderFilters() {
  populateSourceFilter();

  populate(
    "location",
    unique("location")
  );

  populate(
    "employment",
    unique("employment_type")
  );

  populate(
    "experience",
    unique("experience")
  );
}


/* =========================================================
   MATCH SCORE
   ========================================================= */

const DEFAULT_MATCH_KEYWORDS = [
  "flutter",
  "dart",
  "mobile",
  "ios",
  "android",
  "swift",
  "swiftui",
  "uikit",
  "firebase",
  "rest api",
  "api",
  "git",
  "github",
  "bloc",
  "provider",
  "riverpod",
  "getx",
  "mvvm",
  "mvc",
  "xcode",
  "application development",
  "mobile application",
];

function calculateFallbackMatch(j) {
  const text = normalizeText(
    [
      j.title,
      j.description,
      ...(j.skills || []),
      j.experience,
    ].join(" ")
  );

  if (!text) return 0;

  let matched = 0;

  for (const keyword of DEFAULT_MATCH_KEYWORDS) {
    if (text.includes(normalizeText(keyword))) {
      matched++;
    }
  }

  const score = Math.round(
    (matched / DEFAULT_MATCH_KEYWORDS.length) * 100
  );

  return Math.min(100, Math.max(0, score));
}

function getMatchScore(j) {
  const stored = Number(j.match_score);

  if (
    Number.isFinite(stored) &&
    stored > 0
  ) {
    return Math.min(100, Math.max(0, Math.round(stored)));
  }

  return calculateFallbackMatch(j);
}


/* =========================================================
   FILTERING
   ========================================================= */

function filteredJobs() {
  const searchEl = $("search");
  const locationEl = $("location");
  const employmentEl = $("employment");
  const experienceEl = $("experience");
  const sortEl = $("sort");
  const sourceEl = $("source");

  const q = searchEl
    ? searchEl.value.toLowerCase().trim()
    : "";

  const loc = locationEl
    ? locationEl.value
    : "";

  const type = employmentEl
    ? employmentEl.value
    : "";

  const exp = experienceEl
    ? experienceEl.value
    : "";

  const source = sourceEl
    ? sourceEl.value
    : state.source;

  const sort = sortEl
    ? sortEl.value
    : "score";

  let jobs = state.jobs.filter((j) => {
    const hay = [
      j.title,
      j.company,
      j.location,
      j.description,
      j.skills,
      j.source,
      j.employment_type,
      j.experience,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      !q || hay.includes(q);

    const matchesSource =
      !source ||
      normalizeSource(j.source) === source;

    const matchesLocation =
      !loc || j.location === loc;

    const matchesType =
      !type ||
      j.employment_type === type;

    const matchesExperience =
      !exp ||
      j.experience === exp;

    return (
      matchesSearch &&
      matchesSource &&
      matchesLocation &&
      matchesType &&
      matchesExperience
    );
  });

  jobs.sort((a, b) => {
    if (sort === "company") {
      return String(a.company || "").localeCompare(
        String(b.company || "")
      );
    }

    if (sort === "title") {
      return String(a.title || "").localeCompare(
        String(b.title || "")
      );
    }

    if (sort === "newest") {
      const da = parseDate(a.posted_at)?.getTime() || 0;
      const db = parseDate(b.posted_at)?.getTime() || 0;

      return db - da;
    }

    return getMatchScore(b) - getMatchScore(a);
  });

  return jobs;
}


/* =========================================================
   CHIPS
   ========================================================= */

function renderChips() {
  const chips = [];

  if ($("search")?.value.trim()) {
    chips.push([
      "Search",
      $("search").value.trim(),
      "search",
    ]);
  }

  if ($("source")?.value) {
    chips.push([
      "Source",
      $("source").value,
      "source",
    ]);
  }

  if ($("location")?.value) {
    chips.push([
      "Location",
      $("location").value,
      "location",
    ]);
  }

  if ($("employment")?.value) {
    chips.push([
      "Job type",
      $("employment").value,
      "employment",
    ]);
  }

  if ($("experience")?.value) {
    chips.push([
      "Experience",
      $("experience").value,
      "experience",
    ]);
  }

  if (!$("chips")) return;

  $("chips").innerHTML = chips
    .map(
      ([label, value, key]) =>
        `<span class="chip">
          ${escapeHtml(label)}:
          ${escapeHtml(value)}
          <button
            data-clear="${escapeHtml(key)}"
            aria-label="Remove ${escapeHtml(label)} filter"
          >×</button>
        </span>`
    )
    .join("");
}


/* =========================================================
   LOGO
   ========================================================= */

function logoFor(j) {
  const company = String(
    j.company || "Company"
  ).trim();

  return escapeHtml(
    (company[0] || "C").toUpperCase()
  );
}


/* =========================================================
   POSTED DATE
   ========================================================= */

function formatPosted(value) {
  const d = parseDate(value);

  if (!d) {
    return "Date not listed";
  }

  return d.toLocaleDateString(
    undefined,
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  );
}


/* =========================================================
   JOB CARD
   ========================================================= */

function card(j, i) {
  const skills = arr(j.skills).slice(0, 6);

  const exp =
    j.experience || "";

  const type =
    j.employment_type ||
    "Full-time";

  const location =
    j.location ||
    "Location not listed";

  const company =
    j.company ||
    "Company not listed";

  const source =
    normalizeSource(j.source);

  const score =
    getMatchScore(j);

  const id =
    j.id ||
    j.job_id ||
    j.original_url ||
    `${j.title || "job"}-${company}`;

  const saved =
    state.saved.has(String(id));

  const desc =
    strip(j.description);

  const posted =
    j.posted_at
      ? formatPosted(j.posted_at)
      : "Date not listed";

  const url =
    j.original_url ||
    "#";

  return `
    <article class="job">

      <div class="company-logo alt${i % 5}">
        ${logoFor(j)}
      </div>

      <div class="job-main">

        <div class="job-title-row">

          <h2 class="job-title">
            ${escapeHtml(
              j.title || "Untitled role"
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
              exp || "Experience not listed"
            )}
          </span>

          <span class="meta-item">
            <span class="meta-icon">♧</span>
            ${escapeHtml(
              j.company_size ||
              "Company size: Unknown"
            )}
          </span>

        </div>

        ${
          skills.length
            ? `
              <div class="skills">
                ${skills
                  .map(
                    (skill, n) =>
                      `<span class="tag${
                        n > 3
                          ? " neutral"
                          : ""
                      }">
                        ${escapeHtml(skill)}
                      </span>`
                  )
                  .join("")}
              </div>
            `
            : ""
        }

        ${
          desc
            ? `
              <div class="description">
                ${escapeHtml(desc)}
              </div>
            `
            : ""
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
          class="bookmark ${
            saved ? "saved" : ""
          }"
          data-save="${escapeHtml(
            String(id)
          )}"
          title="${
            saved
              ? "Remove saved job"
              : "Save job"
          }"
          aria-label="${
            saved
              ? "Remove saved job"
              : "Save job"
          }"
        >
          ${saved ? "★" : "☆"}
        </button>

        <a
          class="view"
          href="${escapeHtml(url)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          View Job ↗
        </a>

      </div>

    </article>
  `;
}


/* =========================================================
   RENDER
   ========================================================= */

function render() {
  const jobs = filteredJobs();

  if ($("count")) {
    $("count").textContent =
      `Showing ${jobs.length} of ${
        state.jobs.length
      } matched job${
        state.jobs.length === 1
          ? ""
          : "s"
      }`;
  }

  renderChips();

  if ($("jobs")) {
    $("jobs").innerHTML =
      jobs.map(card).join("");
  }

  if ($("empty")) {
    $("empty").classList.toggle(
      "hidden",
      jobs.length > 0
    );
  }

  renderStats();
}


/* =========================================================
   STATS
   ========================================================= */

function renderStats() {
  const m = state.meta || {};

  const sourceCounts = {};

  state.jobs.forEach((job) => {
    const source =
      normalizeSource(job.source);

    sourceCounts[source] =
      (sourceCounts[source] || 0) + 1;
  });

  const sources =
    Object.keys(sourceCounts);

  const total =
    state.jobs.length;

  const uniqueIds =
    new Set(
      state.jobs.map(getDedupKey)
    );

  const currentSource =
    state.source ||
    sources[0] ||
    "All Sources";

  const sourceLabel =
    currentSource === ""
      ? "All Sources"
      : currentSource;

  const cards = [
    [
      "▣",
      "Jobs Collected",
      m.collected_jobs ??
        m.total_jobs ??
        total,
      "After 3-month filter",
    ],
    [
      "▤",
      "Unique Jobs",
      uniqueIds.size,
      "After deduplication",
    ],
    [
      "✦",
      "Recent Jobs",
      total,
      "Posted in last 3 months",
    ],
    [
      "☆",
      "Matched Jobs",
      total,
      "Available jobs",
    ],
    [
      "◎",
      "Source Status",
      sourceLabel,
      sources.length
        ? sources.join(" + ")
        : "No source data",
    ],
  ];

  if ($("stats")) {
    $("stats").innerHTML =
      cards
        .map((c, i) => {
          if (i === 4) {
            return `
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

                    ${escapeHtml(
                      c[2]
                    )}

                    <span class="enabled">
                      Enabled
                    </span>

                  </div>

                  <div class="stat-sub">
                    ${escapeHtml(
                      c[3]
                    )}
                  </div>

                </div>

              </div>
            `;
          }

          return `
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
          `;
        })
        .join("");
  }

  const primarySource =
    sources.length === 1
      ? sources[0]
      : "Naukri + Adzuna";

  if ($("sourceName")) {
    $("sourceName").textContent =
      primarySource;
  }

  const raw =
    m.last_run_utc ||
    m.updated_at ||
    m.updated_at_utc;

  const formatted = raw
    ? formatUpdatedDate(raw)
    : "Waiting for first run";

  if ($("updated")) {
    $("updated").textContent =
      formatted;
  }

  if ($("footerUpdated")) {
    $("footerUpdated").textContent =
      "Last updated: " + formatted;
  }
}

function formatUpdatedDate(value) {
  const d = parseDate(value);

  if (!d) {
    return "Waiting for first run";
  }

  return d.toLocaleString(
    undefined,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }
  );
}


/* =========================================================
   CLEAR FILTERS
   ========================================================= */

function clearFilters() {
  if ($("search")) {
    $("search").value = "";
  }

  if ($("source")) {
    $("source").value = "";
  }

  if ($("location")) {
    $("location").value = "";
  }

  if ($("employment")) {
    $("employment").value = "";
  }

  if ($("experience")) {
    $("experience").value = "";
  }

  if ($("sort")) {
    $("sort").value = "score";
  }

  state.source = "";

  localStorage.setItem(
    "job-agent-source",
    ""
  );

  render();
}


/* =========================================================
   EVENT LISTENERS
   ========================================================= */

if ($("search")) {
  $("search").addEventListener(
    "input",
    render
  );
}

[
  "location",
  "employment",
  "experience",
  "sort",
].forEach((id) => {
  if ($(id)) {
    $(id).addEventListener(
      "change",
      render
    );
  }
});


/* SOURCE FILTER */

document.addEventListener(
  "change",
  (event) => {
    if (
      event.target &&
      event.target.id === "source"
    ) {
      state.source =
        event.target.value || "";

      localStorage.setItem(
        "job-agent-source",
        state.source
      );

      render();
    }
  }
);


/* CLEAR BUTTON */

if ($("clear")) {
  $("clear").addEventListener(
    "click",
    clearFilters
  );
}

if ($("emptyClear")) {
  $("emptyClear").addEventListener(
    "click",
    clearFilters
  );
}


/* REFRESH */

if ($("refresh")) {
  $("refresh").addEventListener(
    "click",
    () => load()
  );
}


/* RUN SEARCH */

if ($("runSearch")) {
  $("runSearch").addEventListener(
    "click",
    () => load()
  );
}


/* FILTER CHIPS */

if ($("chips")) {
  $("chips").addEventListener(
    "click",
    (event) => {
      const key =
        event.target.dataset.clear;

      if (!key) return;

      if (key === "search") {
        if ($("search")) {
          $("search").value = "";
        }
      } else if (key === "source") {
        state.source = "";

        localStorage.setItem(
          "job-agent-source",
          ""
        );

        if ($("source")) {
          $("source").value = "";
        }
      } else {
        const el = $(key);

        if (el) {
          el.value = "";
        }
      }

      render();
    }
  );
}


/* SAVE / UNSAVE JOB */

if ($("jobs")) {
  $("jobs").addEventListener(
    "click",
    (event) => {
      const btn =
        event.target.closest(
          "[data-save]"
        );

      if (!btn) return;

      const id =
        String(btn.dataset.save);

      if (state.saved.has(id)) {
        state.saved.delete(id);
      } else {
        state.saved.add(id);
      }

      localStorage.setItem(
        "job-agent-saved",
        JSON.stringify([
          ...state.saved,
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
