# margin-rates

Lightweight personal scraper for TradeStation Futures Margin Requirements.

## What this does

- Runs a scheduled GitHub Action (`.github/workflows/scrape-tradestation-margins.yml`)
- Scrapes the public TradeStation futures margin table
- Writes latest data to `docs/data/latest.json`
- Writes change snapshots to `docs/data/history/*.json`
- Adds a `category` field to each contract row based on TradeStation section grouping
- Serves JSON from GitHub Pages

## JSON URL (after Pages is enabled)

`https://<your-github-username>.github.io/<repo-name>/data/latest.json`

## One-time setup

1. Push this repo to GitHub.
2. In GitHub repo settings, enable **Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/docs`
3. Run the action once manually from **Actions** tab:
   - Workflow: `Scrape TradeStation Futures Margins`
   - Click **Run workflow**

## Schedule

Current cron is every 15 minutes on weekdays (UTC):

`*/15 * * * 1-5`

Adjust the cron in `.github/workflows/scrape-tradestation-margins.yml` as needed.

## Notes

- The scraper only commits when the table data changes.
- This project is for personal use; verify website terms before scaling access.
- TradeStation states published margins may change and may not always reflect real-time requirements.
