# Spend — money-flow visualiser

A private, in-browser app that turns a bank-statement CSV into an interactive
**Sankey money-flow diagram** plus supporting charts. Feed it a statement, filter
freely, and watch every view refresh instantly.

> **Everything runs in your browser.** Your statement is parsed locally and is
> never uploaded anywhere — there is no server and no telemetry.

## Run it

```bash
npm install
npm run dev      # opens http://localhost:5173
```

The app loads your bundled statement (`public/sample-statement.csv`) on start.
Drop any other CSV onto the window — or use **Load CSV** — to visualise it.

```bash
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## What it does

- **Sankey money flow** — income sources → *available* → where it goes → categories.
  Click any group or category node to filter the whole app to it.
- **Reactive filters** (one row, top): date range presets + custom range, flow
  direction (In / Out / Internal), groups, categories, behavioural tags, merchant
  search, and an amount range. Every chart, tile and table re-renders together.
- **Auto-tagging** — each transaction is classified into a group
  (required / optional / to-people / savings / income) and a category
  (groceries, eating out, utilities, …) by a merchant ruleset, and given
  behavioural tags: `#recurring`, `#large`, `#weekend`, `#cash`, `#internal`.
- **Custom categories & rules** — manually assign a group + category to an entire
  merchant, overriding the automatic tagging everywhere (type a new category name
  to create one). Rules persist in your browser; assign directly from the
  merchant-grouped table. Reclassification respects each transaction's sign — a
  refund at a merchant you mark as spending stays income rather than inflating it.
- **Groups — include / exclude** — a searchable table that groups every
  transaction by category, merchant, or top-level group. Each group has a
  checkbox (ticked by default); unticking one drops it from **every** chart, tile
  and total. A header checkbox toggles all (with an indeterminate state), and each
  row expands to show its transactions.
- **Supporting views** — stat tiles, monthly in/out/net trend, top categories,
  top merchants, a recurring-commitments (subscriptions & bills) panel, and a
  sortable, expandable transaction table.
- **Export** the tagged transactions as CSV; toggle light/dark.

### A note on "internal" transfers

Moves between *your own* accounts (deposits, Revolut top-ups, own-account
transfers) are **hidden by default** — they dwarf real spending and aren't
spending. Enable the **Internal** chip to fold them back in and see the savings
branch.

## Supported statements

- **Banca Transilvania / ING Romania** `Tranzactii_*.csv` block export (primary,
  fully tagged).
- **Revolut** account-statement CSV export (`Type, …, Amount, Fee, State, …`) —
  non-completed rows are skipped, fees counted, and types (Card Payment, Interest,
  Transfer, Deposit, Exchange, Charge) mapped to spend / income / internal.
- **Generic flat CSVs** — the parser falls back to heuristic column detection
  (date / description / amount, or debit+credit). Tagging still runs on the
  description, so categorisation is rougher.

To tune categorisation for your merchants, edit the ruleset in
[`src/lib/tagging.ts`](src/lib/tagging.ts).

## Deploy (GitHub Pages)

This is a static site, so it deploys itself. A push to `master` runs
`.github/workflows/deploy.yml`, which builds and publishes to GitHub Pages at
`https://<user>.github.io/spend/`. The deployed app ships **no data** — everyone
who opens it loads their own CSV, parsed locally in their own browser.

The build base path defaults to `/spend/`; if you fork under a different repo name,
build with `VITE_BASE=/your-repo/ npm run build` (the workflow reads `VITE_BASE`).

> Never commit or deploy a real statement. `public/sample-statement.csv` and
> `Tranzactii_*.csv` are gitignored for this reason.

## Verify the parsing math

`scripts/verify.ts` runs the full parse → tag → Sankey → stats pipeline against a
CSV in Node and checks flow conservation:

```bash
npx esbuild scripts/verify.ts --bundle --platform=node --format=esm --outfile=/tmp/v.mjs && node /tmp/v.mjs
```
