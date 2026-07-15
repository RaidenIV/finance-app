# HomeLedger — MongoDB Edition

HomeLedger is a responsive household finance application built with HTML, CSS, vanilla JavaScript, Node.js, Express, and MongoDB. It imports CSV and text-based PDF bank statements, lets users review and categorize transactions, and synchronizes one shared household ledger across desktop and mobile devices.

## What changed in version 2

- Financial data is stored in MongoDB instead of browser `localStorage`.
- Each person has a separate email/password login.
- The first user creates a household and receives an invite code.
- A spouse or household member can create a separate login and join with that code.
- Approved transactions, accounts, rules, imports, household settings, and display settings synchronize through the Railway API.
- Session cookies are HTTP-only and sessions are stored in MongoDB.
- Passwords are hashed with bcrypt.
- Household writes use version checks so a stale browser cannot silently overwrite newer data from another device.
- Uploaded statement files are parsed in the browser. The original CSV/PDF is not saved to the server; only the approved transaction records are synchronized.

## Technology

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js and Express
- Database: MongoDB with Mongoose
- Authentication: `express-session`, `connect-mongo`, and `bcryptjs`
- Hosting: GitHub source repository + Railway application service + Railway MongoDB service

## Project structure

```text
homeledger-mongodb/
├── public/
│   ├── app.js
│   ├── index.html
│   ├── sample-bank-statement.csv
│   └── styles.css
├── .env.example
├── .gitignore
├── DEPLOYMENT.md
├── package.json
├── railway.json
├── README.md
└── server.js
```

## Local development

You need Node.js 20+ and a MongoDB connection string.

1. Copy `.env.example` to `.env`.
2. Set `MONGO_URL` and a long random `SESSION_SECRET`.
3. Install dependencies:

```bash
npm install
```

4. Start HomeLedger:

```bash
npm run dev
```

5. Open:

```text
http://localhost:3000
```

The health endpoint is:

```text
http://localhost:3000/health
```

## First-use workflow

1. Choose **Create account**.
2. Enter your name, email, password, and household name.
3. Open **Settings → Shared household access**.
4. Copy the household invite code.
5. Your wife chooses **Create account → Join with code** and enters that code.
6. Both logins will use the same MongoDB-backed household ledger.

## Statement import behavior

- CSV is the preferred format because it is structured and more reliable.
- Text-based PDFs are supported through PDF.js.
- Scanned/image-only PDFs require OCR and are not supported in this version.
- Files are parsed in the browser.
- The review screen lets you correct dates, merchants, categories, owners, types, and amounts.
- Only selected and approved transaction records are sent to the server.
- Possible duplicates and internal transfers are flagged before import.

## Data model

MongoDB stores:

- `users` — account identity, password hash, household membership, and role
- `households` — household name and invite code
- `householdstates` — the synchronized household ledger and version number
- `sessions` — authenticated browser sessions

## Important production notes

- Keep the GitHub repository private because this is a personal financial application.
- Never commit `.env`.
- Use Railway's variable reference picker for the MongoDB connection string.
- Set a unique `SESSION_SECRET` with at least 32 characters.
- Keep Railway's generated HTTPS domain enabled; secure cookies depend on HTTPS in production.
- Export periodic JSON backups from HomeLedger in addition to any Railway database backups.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete GitHub and Railway setup.
