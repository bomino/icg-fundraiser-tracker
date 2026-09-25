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
8. Add pledges and payments through the app, not by typing into the **Pledges** or **Payments** tabs. The app ignores any row with an empty `id` in column A, so a row typed straight into the Sheet without one won't appear or count anywhere. If you must add rows by hand, give each one a unique `id` (any text not used by another row).

## 2. The Google sign-in client

1. Go to <https://console.cloud.google.com/>, create a project (for example `icg-fundraiser`), and select it.
2. **APIs & Services → OAuth consent screen**: choose **External** and fill in the app name and your support email. Under **Audience**, press **Publish app**. With only the basic sign-in scopes this needs no Google review, and it lets any allowlisted volunteer sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Under **Authorized JavaScript origins** add:
   - `https://<your-github-username>.github.io`
   - `http://localhost:5173` and `http://localhost` (Google's sign-in setup guide asks for both when testing locally)
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
5. In Apps Script, go to **Project Settings → Script properties → Add**: name `CLIENT_ID`, value = that Client ID.

## 3. Deploy the API

1. In Apps Script, go to **Deploy → New deployment → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. "Anyone" only lets the request reach the script. The script itself rejects anyone who isn't signed in and on the Allowlist.
3. Copy the **Web app URL**. It ends in `/exec`.

When you change `Code.gs` later, use **Deploy → Manage deployments → ✎ → Version: New version**. That keeps the same URL. In the new version's **Description**, type the short id of the commit you're deploying (`git rev-parse --short HEAD`), so you can tell later which version goes with which commit. Update `Code.gs` (as a new deployment version) and the website in the same sitting: if the two don't match, adding new pledges and payments breaks.

## 4. Publish the site

1. Create a GitHub repository. It must be public for free GitHub Pages. The code holds no donor data, and the data stays in your private Sheet.
2. Push this folder to it. `.gitignore` keeps the `.xlsx` and `.docx` files out.
3. In the repository, go to **Settings → Pages → Source: GitHub Actions**.
4. **Settings → Secrets and variables → Actions → Variables**: add `VITE_SCRIPT_URL` (from step 3) and `VITE_GOOGLE_CLIENT_ID` (from step 2).
5. **Actions → Test and deploy → Run workflow**. When it finishes, the site is at `https://<user>.github.io/<repo>/`. If the run shows as failed, open it: when only the **e2e** job (the browser tests) failed, the **deploy** job still published the site.

## Undoing a bad update

If an update breaks the app, go back to the last version that worked. If the bad update changed `apps-script/Code.gs` as well as the site, roll back both in the same sitting: undoing only one of them leaves the two out of step, and adding pledges and payments breaks.

1. **The site.** Run `git revert <bad commit>` (`git revert -m 1 <bad commit>` if it's a merge commit) and push to `main`; the workflow tests and publishes the older code as usual. For a quicker stopgap, open the last good run on `main` under **Actions → Test and deploy** and press **Re-run jobs → Re-run all jobs** (possible for 30 days after the run; if it fails, use `git revert`). Revert anyway before anyone pushes again, or the next push publishes the bad update again. Don't use **Run workflow** on a tag or another branch: the `github-pages` environment only lets the default branch (`main`) publish.
2. **`Code.gs`.** In Apps Script, go to **Deploy → Manage deployments → ✎ → Version**, pick the last number that worked, usually the previous one (its **Description** names the commit it came from), then press **Deploy**. The URL stays the same. Then paste the matching older `Code.gs` (`apps-script/Code.gs` on the reverted `main`) back into the editor, or the next **New version** brings the bad code back.
3. If adding a pledge or payment then says *Someone else deleted this row*, the two are still out of step (see Troubleshooting).

## Local development

Create `.env.local` (git-ignored) in the repo root:

```
VITE_SCRIPT_URL=https://script.google.com/macros/s/…/exec
VITE_GOOGLE_CLIENT_ID=….apps.googleusercontent.com
```

Then run `npm install`, then `npm run dev`, and open <http://localhost:5173>.

## Data safety routine

The Sheet is the only copy of the fundraiser's records — there is no separate database or backup service behind it. Do these as the organiser:

1. **Version history is the undo button.** In the Google Sheet, **File → Version history → See version history**, find the version from before a bad change, and press **Restore this version**.
2. **Download a copy monthly, and after each event.** On **Summary**, press **Download .xlsx**, and keep the file somewhere safe — a laptop, a shared drive — outside the Sheet itself.
3. **Share the Sheet with a second trusted person as an Editor** (not just Viewer), so access to the fundraiser's records is never locked to one person's Google account.
4. **Never delete the Sheet or its Apps Script project.** It is the tracker's only database; deleting either takes every pledge and payment with it.

## Troubleshooting

| The app says | Likely cause and fix |
|---|---|
| *The server is not configured: set the CLIENT_ID script property* | The `CLIENT_ID` script property is missing or misnamed. Add it as in step 2.5, then try again. No redeploy is needed. |
| *Your sign-in has expired. Please sign in again.* on every attempt | The `CLIENT_ID` script property and the site's `VITE_GOOGLE_CLIENT_ID` hold different client IDs. Make them identical. |
| *Could not reach the tracker … may not allow access to "Anyone"*, or *The tracker sent back an unexpected page* | The deployment's **Who has access** isn't **Anyone**, or `VITE_SCRIPT_URL` isn't the `/exec` URL. Fix it under **Deploy → Manage deployments** (step 3). If the device really is offline, the message stops at "try again". |
| *… is not on the volunteer list* | That Google account isn't on the **Allowlist** tab. Add the email exactly, one per row (step 1.6), or sign in with the listed account. |
| *Someone else deleted this row* when **adding** a pledge or payment, or *Missing or malformed row id* | The site and `Code.gs` are out of step: `Code.gs` was changed without deploying a **new version**, or the site wasn't rebuilt. Redeploy `Code.gs` (**Manage deployments → ✎ → New version**) and re-run the site's workflow. |
