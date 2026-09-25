# Setting up the Fundraiser Tracker web app

One-time setup, about 30 minutes. You need a Google account (the organiser's) and a GitHub account.

## 1. The data Sheet and its API

1. Create a new Google Sheet named **ICG Fundraiser Data**. Keep it private. Nobody else needs access to it.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo.
4. Open **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, then replace that file with `apps-script/appsscript.json`.
5. Back in the editor, pick `setup` from the function list and press **Run**. Approve the permissions. The Sheet now has the **Pledges**, **Payments**, **Settings** and **Allowlist** tabs, and your own email is on the Allowlist. It also has **Pledges history** and **Payments history**, where the app keeps the old copy of every row a volunteer edits or deletes (see [Data safety routine](#data-safety-routine)).
6. Add each volunteer's Google email to the **Allowlist** tab, one per row. To remove access later, delete their row. It takes effect on their next click.
7. Don't format the Pledges or Payments data columns as **Plain text** in the Sheet UI. The app forces text (ids, phone numbers, dates) by writing a leading apostrophe on every value; a Plain text column stores that apostrophe as a literal character instead of hiding it, which corrupts ids and phone numbers. Leave the columns on Automatic.
8. Add pledges and payments through the app, not by typing into the **Pledges** or **Payments** tabs. The app ignores any row with an empty `id` in column A, so a row typed straight into the Sheet without one won't appear or count anywhere. If you must add rows by hand, give each one a unique `id` (any text not used by another row).
9. Add your own columns to the **Pledges** or **Payments** tabs only to the right of the last one, `updatedBy`, and don't rename, move or delete the existing columns, or rename or delete any tab. The app reads and writes those columns by position, so after such a change it refuses to load or save until the change is undone (**File → Version history** is the quickest way), and its message names the first column that's out of place. Changing only a header's capitals, spaces or punctuation (`Amount Pledged` for `amountPledged`) is fine.

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

When you change `Code.gs` later, use **Deploy → Manage deployments → ✎ → Version: New version**. That keeps the same URL. Update `Code.gs` (as a new deployment version) and the website in the same sitting: if the two don't match, adding new pledges and payments breaks.

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

## Data safety routine

The Sheet is the only copy of the fundraiser's records — there is no separate database or backup service behind it. Do these as the organiser:

1. **Bring back a deleted or changed row by copying it, never by restoring the file.** Whenever a volunteer edits or deletes a pledge or payment, the app first copies the old row to the **Pledges history** or **Payments history** tab. Its last three columns say when (`changedAt`), who (`changedBy`, the volunteer's email) and what (`action`: `edit` or `delete`). On a Sheet set up before these tabs existed, each one appears with the first edit or delete after `Code.gs` is updated.
   - To bring a row back, copy exactly its first 8 cells, `id` to `updatedBy`. For a deleted row, paste them into the first empty row of **Pledges** or **Payments**. For an edited row, paste them over the live row with the same `id` instead, or it is counted twice. The row keeps its `id`, so volunteers see it after pressing **Refresh**.
   - For a change the history tabs don't have (one from before they existed, or one made directly in the Sheet), open **File → Version history → See version history**, click a version from before the mistake, copy the row's first 8 cells there, and paste them into the current Sheet the same way.
   - **Don't press Restore this version** to get a row back. It rolls back the whole file, every tab, so every pledge and payment any volunteer entered or changed since that version is lost, along with Allowlist and Settings changes.
   - The app never loads the history tabs, so volunteers never see or download them. They do keep deleted rows, phone numbers included: to remove a donor's details for good, delete their rows there too.
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
| *The 3rd column of the "Pledges" tab should be …* | A column was inserted, moved or deleted in that tab, or its header row was cleared (step 1.9). Undo it with **File → Version history**, or move a new column to the right of `updatedBy`. |
| *The "Pledges" tab is missing* | The tab was renamed or deleted. Rename it back, or restore a deleted one with **File → Version history**. Don't run `setup()` again: it adds a new, empty tab and leaves the records in the renamed one. |
| *Someone else deleted this row* when **adding** a pledge or payment, or *Missing or malformed row id* | The site and `Code.gs` are out of step: `Code.gs` was changed without deploying a **new version**, or the site wasn't rebuilt. Redeploy `Code.gs` (**Manage deployments → ✎ → New version**) and re-run the site's workflow. |

### Reading the server's log

When a volunteer reports *Something went wrong on the server*, or you want to check the tracker is healthy, open the Sheet's **Extensions → Apps Script**, then **Executions** in the left-hand menu. Each `doPost` row is one request from the app. The server answers every problem itself, so a failed request still shows as **Completed**: click the row to open its log. Most runs log nothing.

If every row says *No logs are available for this execution*, even for a request you know failed, Google is keeping those logs off this page. It does that for requests that arrive without a Google sign-in of their own, and the app's requests do: the volunteer's sign-in travels inside the request instead. The lines are still written, but to Google Cloud, and you can read them there once the script is linked to the Cloud project you made in step 2 (runs from before the link stay hidden). You only do this once, it can't be undone, and it's best done when no one is using the tracker:

1. In the Google Cloud console, open that project and copy its **Project number** (on the project's dashboard, or under **IAM & Admin → Settings**).
2. In Apps Script, open **Project Settings**, and under **Google Cloud Project** press **Change project**. Paste the number and press **Set project**.
3. Straight away, pick `setup` from the editor's function list, press **Run** and approve the permissions again. Google makes everyone who approved the script approve it again after the switch, and the app's requests run as you, so they can fail until you have. If Google says it hasn't verified the app, press **Advanced** and carry on: it's your own script. `setup` only adds tabs that are missing, so it changes none of your records.

From then on, read the log in the Google Cloud console: open the project, then **Logging → Logs Explorer**, and search for the lines below.

These are the lines to look for:

- `BUSY in upsertPledge: The tracker is busy…`: a save or delete waited more than 10 seconds for others to finish, and the volunteer was asked to try again. The odd one on a busy day is harmless; many close together mean the Sheet is slow or very busy.
- `FORBIDDEN in load: someone@example.com is not on the volunteer list.`: that Google account was turned away. If it belongs to a volunteer, compare it with their row on the **Allowlist** tab (step 1.6).
- `Unhandled server error in <operation>: …`: something unexpected failed, and its first line says what. `Service Spreadsheets timed out` or a quota message is on Google's side, so try again later. A `TypeError` or `ReferenceError` just after a `Code.gs` change is a mistake in that change: switch the deployment back to the previous version (**Manage deployments → ✎ → Version**). The `at …` lines below it name the function and the `Code` line that failed. Where a volunteer's sign-in token would appear, the log shows `<token>` instead.
