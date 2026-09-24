# Setting up the Fundraiser Tracker web app

One-time setup, about 30 minutes. You need a Google account (the organiser's) and a GitHub account.

## 1. The data Sheet and its API

1. Create a new Google Sheet named **ICG Fundraiser Data**. Keep it private. Nobody else needs access to it.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo.
4. Open **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, then replace that file with `apps-script/appsscript.json`.
5. Back in the editor, pick `setup` from the function list and press **Run**. Approve the permissions. The Sheet now has the **Pledges**, **Payments**, **Settings** and **Allowlist** tabs, and your own email is on the Allowlist.
6. Add each volunteer's Google email to the **Allowlist** tab, one per row. To remove access later, delete their row. It takes effect on their next click.
7. Don't format the Pledges or Payments data columns as **Plain text** in the Sheet UI. The app forces text (ids, phone numbers, dates) by writing a leading apostrophe on every value; a Plain text column stores that apostrophe as a literal character instead of hiding it, which corrupts ids and phone numbers. Leave the columns on Automatic.

## 2. The Google sign-in client

1. Go to <https://console.cloud.google.com/>, create a project (for example `icg-fundraiser`), and select it.
2. **APIs & Services → OAuth consent screen**: choose **External** and fill in the app name and your support email. Under **Audience**, press **Publish app**. With only the basic sign-in scopes this needs no Google review, and it lets any allowlisted volunteer sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Under **Authorized JavaScript origins** add:
   - `https://<your-github-username>.github.io`
   - `http://localhost:5173` (for local testing)
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
5. In Apps Script, go to **Project Settings → Script properties → Add**: name `CLIENT_ID`, value = that Client ID.

## 3. Deploy the API

1. In Apps Script, go to **Deploy → New deployment → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. "Anyone" only lets the request reach the script. The script itself rejects anyone who isn't signed in and on the Allowlist.
3. Copy the **Web app URL**. It ends in `/exec`.

When you change `Code.gs` later, use **Deploy → Manage deployments → ✎ → Version: New version**. That keeps the same URL.

## 4. Publish the site

1. Create a GitHub repository. It must be public for free GitHub Pages. The code holds no donor data, and the data stays in your private Sheet.
2. Push this folder to it. `.gitignore` keeps the `.xlsx` and `.docx` files out.
3. In the repository, go to **Settings → Pages → Source: GitHub Actions**.
4. **Settings → Secrets and variables → Actions → Variables**: add `VITE_SCRIPT_URL` (from step 3) and `VITE_GOOGLE_CLIENT_ID` (from step 2).
5. **Actions → Test and deploy → Run workflow**. When it finishes, the site is at `https://<user>.github.io/<repo>/`.

## Local development

Create `.env.local` (git-ignored) in the repo root:

```
VITE_SCRIPT_URL=https://script.google.com/macros/s/…/exec
VITE_GOOGLE_CLIENT_ID=….apps.googleusercontent.com
```

Then run `npm install`, then `npm run dev`, and open <http://localhost:5173>.

## Troubleshooting

| The app says | Likely cause and fix |
|---|---|
| *The server is not configured: set the CLIENT_ID script property* | The `CLIENT_ID` script property is missing or misnamed. Add it as in step 2.5, then try again. No redeploy is needed. |
| *Your sign-in has expired. Please sign in again.* on every attempt | The `CLIENT_ID` script property and the site's `VITE_GOOGLE_CLIENT_ID` hold different client IDs. Make them identical. |
| *Could not reach the tracker … may not allow access to "Anyone"*, or *The tracker sent back an unexpected page* | The deployment's **Who has access** isn't **Anyone**, or `VITE_SCRIPT_URL` isn't the `/exec` URL. Fix it under **Deploy → Manage deployments** (step 3). If the device really is offline, the message stops at "try again". |
| *… is not on the volunteer list* | That Google account isn't on the **Allowlist** tab. Add the email exactly, one per row (step 1.6), or sign in with the listed account. |
| *Someone else deleted this row* when **adding** a pledge or payment, or *Missing or malformed row id* | The site and `Code.gs` are out of step: `Code.gs` was changed without deploying a **new version**, or the site wasn't rebuilt. Redeploy `Code.gs` (**Manage deployments → ✎ → New version**) and re-run the site's workflow. |
