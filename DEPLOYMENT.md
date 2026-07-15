# Deploy HomeLedger with GitHub, Railway, and MongoDB

This version is designed for a GitHub repository connected to a Railway application service and a Railway MongoDB service.

## Architecture

```text
Desktop browser ─┐
Mobile browser ──┼── Railway HomeLedger service ── Railway MongoDB
Wife's browser ──┘
```

The CSV/PDF file is parsed in the browser. After the review step, the approved transaction data is sent to the Railway API and saved in MongoDB.

## Part 1 — Create the GitHub repository

1. Download and extract the HomeLedger MongoDB package.
2. In GitHub, create a new repository, for example:

```text
homeledger
```

3. Set the repository to **Private**.
4. Upload everything inside the extracted project folder to the root of the repository.

The GitHub repository root should look like this:

```text
homeledger/
├── public/
├── .env.example
├── .gitignore
├── DEPLOYMENT.md
├── package.json
├── railway.json
├── README.md
└── server.js
```

Do not upload a `.env` file.

## Part 2 — Create the Railway application

1. Open Railway.
2. Select **New Project**.
3. Select **Deploy from GitHub repo**.
4. Choose the HomeLedger repository.
5. Railway will create the application service. The first deployment may fail until the database and required variables are added; that is expected.

## Part 3 — Add MongoDB

1. In the same Railway project, click **New**.
2. Choose **Database**.
3. Choose **MongoDB**.
4. Wait for the MongoDB service to initialize.

You should now see two services in the same Railway project:

```text
HomeLedger application
MongoDB
```

## Part 4 — Connect the application to MongoDB

1. Open the **HomeLedger application service**, not the MongoDB service.
2. Open **Variables**.
3. Select **New Variable** or use the Railway variable reference picker.
4. Create:

```text
MONGO_URL
```

5. Set its value by referencing the MongoDB service's `MONGO_URL` variable.

Using Railway's reference picker is preferred. The resolved reference generally resembles:

```text
${{MongoDB.MONGO_URL}}
```

The exact service name in the reference will match the name of your MongoDB service. Do not type a guessed reference when the picker is available.

## Part 5 — Add the session secret

In the HomeLedger application service, add:

```text
SESSION_SECRET
```

Use a unique random value of at least 32 characters. You can generate one locally with:

```bash
openssl rand -hex 32
```

Also add:

```text
NODE_ENV=production
```

Your application variables should include:

```text
MONGO_URL=<reference to the MongoDB service MONGO_URL>
SESSION_SECRET=<long random private value>
NODE_ENV=production
```

Do not commit these values to GitHub.

## Part 6 — Redeploy

1. Open the HomeLedger application service.
2. Open **Deployments**.
3. Redeploy the latest commit if Railway did not redeploy automatically after the variable changes.
4. Wait for the deployment to show **Success**.

Railway will run:

```bash
npm start
```

The included `/health` endpoint verifies that the application can reach MongoDB. Railway's health check should return:

```json
{
  "status": "ok",
  "database": "connected"
}
```

## Part 7 — Generate the public domain

1. Open the HomeLedger application service.
2. Open **Settings**.
3. Open **Networking**.
4. Under **Public Networking**, select **Generate Domain**.

Railway will provide a URL similar to:

```text
https://homeledger-production.up.railway.app
```

Open that URL and create the first account.

## Part 8 — Create the shared household

For the first user:

1. Select **Create account**.
2. Leave **Create household** selected.
3. Enter a name, email, password, and household name.
4. Sign in.
5. Open **Settings**.
6. Copy the **Household Invite Code**.

For your wife:

1. Open the same Railway URL on her device.
2. Select **Create account**.
3. Select **Join with code**.
4. Enter her own name, email, and password.
5. Enter the household invite code.

Both accounts now load and update the same household data in MongoDB.

## Part 9 — Future updates

After GitHub and Railway are connected:

```text
Edit files
→ Commit and push to GitHub
→ Railway automatically builds and redeploys
→ The same public URL serves the new version
```

MongoDB data remains separate from the application deployment, so normal code redeployments do not erase household data.

## Troubleshooting

### Deployment says `MONGO_URL or MONGODB_URI is required`

The application service does not have the MongoDB connection reference. Add `MONGO_URL` to the application service using Railway's reference-variable picker.

### Deployment says `SESSION_SECRET must be configured`

Add a random `SESSION_SECRET` with at least 32 characters to the application service variables.

### Health check is failing

Open the application deployment logs and verify:

- The MongoDB service is running.
- `MONGO_URL` references the correct MongoDB service.
- The application and database are in the same Railway project.

### Login works on one device but not another

Each browser has its own secure session cookie. Sign in separately on each device using the same user account, or create the second household login with the invite code.

### Changes were reloaded after editing

HomeLedger uses a household version number to prevent an older browser from silently overwriting newer changes. If another device saves first, the stale browser reloads the newest server copy and displays a notice.

### PDF imported no transactions

The PDF may be scanned or image-only. Export a CSV from the bank when possible. This version supports text-based PDFs but does not include OCR.
