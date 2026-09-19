# Job Search Agent Dashboard v0.4.2

A static GitHub Pages dashboard for the Job Search Agent.

## UI update

This version refreshes the dashboard with the **Visual & Engaging** layout:
- compact left navigation
- colorful metric cards
- source/status header and refresh controls
- multi-filter toolbar with removable filter chips
- dense, scannable job rows with company initials, metadata, skill tags, match score, save button, and View Job action
- responsive mobile/tablet layouts
- saved jobs stored locally in the browser

## Data

The dashboard reads `data/jobs.json` at runtime. The existing GitHub Actions publishing workflow can continue replacing that file; no API credentials are stored in this dashboard.

## GitHub Pages

The included `.github/workflows/pages.yml` publishes the repository with GitHub Pages.
