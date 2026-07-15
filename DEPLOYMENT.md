# Deploy HomeLedger with GitHub and Railway

HomeLedger is configured so the source code lives in GitHub and Railway automatically builds and serves the app.

## 1. Create the GitHub repository

1. Sign in to GitHub.
2. Select **New repository**.
3. Name the repository `homeledger` or another name you prefer.
4. Choose **Private** if you do not want the source code publicly visible.
5. Do not add a README, `.gitignore`, or license when creating the repository because those files are already included.
6. Create the repository.

## 2. Upload the project files

Unzip the HomeLedger download on your computer. Upload the **contents inside the `household-finance-app` folder** to the root of the GitHub repository.

The repository root should look like this:

```text
homeledger/
├── .gitignore
├── DEPLOYMENT.md
├── README.md
├── app.js
├── index.html
├── package-lock.json
├── package.json
├── railway.json
├── sample-bank-statement.csv
├── server.js
└── styles.css
```

Do not upload the outer folder as an extra nested folder. `package.json`, `server.js`, and `index.html` should be visible at the repository root.

Commit the files directly to the `main` branch.

## 3. Create the Railway project

1. Sign in to Railway.
2. Select **New Project**.
3. Choose **Deploy from GitHub repo**.
4. Authorize Railway to access GitHub if prompted.
5. Select the HomeLedger repository.
6. Railway should detect Node.js from `package.json`, build the service, and run `npm start`.

No environment variables or database are required for this version.

## 4. Generate the public Railway URL

After the deployment succeeds:

1. Open the HomeLedger service in Railway.
2. Open **Settings**.
3. Find **Networking → Public Networking**.
4. Select **Generate Domain**.
5. Open the generated `.railway.app` address.

## 5. Automatic deployments

Railway will redeploy the connected service when new commits are pushed to the configured GitHub branch. To publish a future app update:

1. Update the files in GitHub.
2. Commit the change to `main`.
3. Wait for the Railway deployment to finish.
4. Refresh the Railway URL.

## 6. Local testing

Install Node.js 20 or newer, open a terminal in the project folder, and run:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

The health endpoint is available at:

```text
http://localhost:3000/health
```

## Current data-storage behavior

This deployment hosts the app interface, but the finance data remains local to each browser using `localStorage`.

- Statements are processed in the browser.
- Uploaded statements are not stored on Railway by this version.
- Data entered on desktop does not automatically appear on mobile.
- Data entered in your browser does not appear for your wife on another device.
- Use **Settings → Export JSON backup** and **Import JSON backup** to move data between browsers.

True shared household data requires a later backend version with authentication and a database.
