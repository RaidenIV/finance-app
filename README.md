# HomeLedger

HomeLedger is a responsive, local-first household finance dashboard built with HTML, CSS, and JavaScript. It imports CSV and text-based PDF bank statements, lets users review and categorize transactions, and generates household income and spending analytics.

## Run locally

HomeLedger includes a dependency-free Node.js static server for local development and Railway deployment.

Requirements:

- Node.js 20 or newer

Run:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

The deployment health endpoint is:

```text
http://localhost:3000/health
```

## GitHub + Railway deployment

The repository is ready to deploy directly from GitHub to Railway.

Included deployment files:

- `package.json` — defines the Node.js app and `npm start` command
- `server.js` — serves the HTML, CSS, JavaScript, and sample CSV files
- `railway.json` — configures Railway's builder, start command, healthcheck, and restart policy
- `.gitignore` — prevents local and secret files from being committed
- `DEPLOYMENT.md` — step-by-step GitHub and Railway setup instructions

See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete deployment process.

## Import support

- **CSV:** Recommended. The importer detects common Date, Description/Merchant, Amount, Debit, Credit, Withdrawal, and Deposit columns.
- **PDF:** Supports text-based PDFs with recognizable transaction lines. Scanned/image-only PDFs require OCR, which is not included in this static version.

## Privacy

- Files are processed in the browser.
- Transactions, rules, accounts, and settings are stored in `localStorage` on the current device.
- No financial data is uploaded to Railway by this version.
- Use **Settings → Export JSON backup** to move or back up data.

## Important limitation

Hosting the app does not add multi-device synchronization. Browser local storage remains separate on desktop, mobile, and your wife's device. A shared household version requires authentication, a backend API, and a database.

## Included features

- Responsive desktop and mobile layout
- Household dashboard
- Income, spending, net cash flow, and savings-rate metrics
- Six-month income-versus-spending chart
- Spending-by-category donut chart
- Top merchants and recent activity
- CSV import with column detection
- PDF text extraction with transaction heuristics
- Import review and duplicate detection
- Categorization rules
- Transfer suggestions
- Search and transaction filters
- Manual transaction entry and editing
- Account and household settings
- JSON backup and restore
- Sample CSV statement
