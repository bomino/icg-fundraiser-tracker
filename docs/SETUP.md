# Setting up the Fundraiser Tracker web app

One-time setup, about 30 minutes. You need a Google account (the organiser's) and a GitHub account.

## 1. The data Sheet and its API

1. Create a new Google Sheet named **ICG Fundraiser Data**. Keep it private. Nobody else needs access to it.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo.
4. Open **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, then replace that file with `apps-script/appsscript.json`.
5. Back in the editor, pick `setup` from the function list and press **Run**. Approve the permissions. The Sheet now has the **Pledges**, **Payments**, **Settings** and **Allowlist** tabs, and your own email is on the Allowlist. It also has **Pledges history** and **Payments history**, where the app keeps the old copy of every row a volunteer edits or deletes (see [Data safety routine](#data-safety-routine)).
6. Add each volunteer's Google email to the **Allowlist** tab, one per row, in column A. To remember whose address is whose, you can type the heading `name` in cell B1 and each volunteer's name next to their email: the app reads only column A. To remove access later, delete their row. It takes effect on their next click.
7. Don't format the Pledges or Payments data columns as **Plain text** in the Sheet UI. The app forces text (ids, phone numbers, dates) by writing a leading apostrophe on every value; a Plain text column stores that apostrophe as a literal character instead of hiding it, which corrupts ids and phone numbers. Leave the columns on Automatic.
8. Add pledges and payments through the app, not by typing into the **Pledges** or **Payments** tabs. The app ignores any row with an empty `id` in column A, so a row typed straight into the Sheet without one won't appear or count anywhere. The app never fills one in, so a totals or notes row you add under the data stays out of every figure.
   - The **Summary** says how many of those rows look like real entries (a phone number, and on Payments an amount too), in a note under Data health. The note appears once both `Code.gs` and the site are updated.
   - To bring such rows in, give each one an `id` no other row uses. For a batch, type a new word and a number in column A of the first row, such as `dinner1`, then drag the cell's small corner square down the batch to fill `dinner2`, `dinner3` and so on. Use a different word for each batch, so an `id` is never repeated.
   - Correcting an existing row straight in the Sheet is safe. Whenever you type or paste into a row that has an `id`, `Code.gs` writes the time into its `updatedAt` and your email into its `updatedBy` (or `edited in Sheet`, when Google doesn't share who made the edit). A volunteer who opened that row before your fix is then asked to reload, instead of their save putting the old values back. Rows with no `id`, the header row and your own columns to the right of `updatedBy` are left alone. This needs no setup, but it doesn't happen for rows brought in with **File → Import**, so don't use Import to change rows volunteers may be editing.
9. Add your own columns to the **Pledges** or **Payments** tabs only to the right of the last one, `updatedBy`, and don't rename, move or delete the existing columns, or rename or delete any tab. The app reads and writes those columns by position, so after such a change it refuses to load or save until the change is undone (**File → Version history** is the quickest way), and its message names the first column that's out of place. Changing only a header's capitals, spaces or punctuation (`Amount Pledged` for `amountPledged`) is fine.

## 2. The Google sign-in client

1. Go to <https://console.cloud.google.com/>, create a project (for example `icg-fundraiser`), and select it.
2. **APIs & Services → OAuth consent screen**: choose **External** and fill in the app name and your support email. Under **Audience**, press **Publish app**. With only the basic sign-in scopes this needs no Google review, and it lets any allowlisted volunteer sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Under **Authorized JavaScript origins** add only your site's address, `https://<your-github-username>.github.io`. Leave out `localhost` addresses: they would let a page running on someone's own computer sign in to the live tracker with their account. Local work uses demo mode instead (see [Local development](#local-development)).
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
5. In Apps Script, go to **Project Settings → Script properties → Add**: name `CLIENT_ID`, value = that Client ID.

## 3. Deploy the API

1. In Apps Script, go to **Deploy → New deployment → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. "Anyone" only lets the request reach the script. The script itself rejects anyone who isn't signed in and on the Allowlist.
3. Copy the **Web app URL**. It ends in `/exec`.

When you change `Code.gs` later, use **Deploy → Manage deployments → ✎ → Version: New version**. That keeps the same URL. Update `Code.gs` (as a new deployment version) and the website in the same sitting, `Code.gs` first (before you push the change to `main`, which rebuilds the website): if the two don't match, adding new pledges and payments can fail with misleading messages.

The app checks this for you. Each `Code.gs` has a line near the top like `const API_VERSION = 1;`, and the website is built for one number. After every load the app compares the two, and while they differ every volunteer sees a strip under the top bar (see [Troubleshooting](#troubleshooting)). It doesn't stop anyone saving. To see which `Code.gs` the website needs, open the app's **Help → For the organiser → Setup and troubleshooting**: it names the commit the site was built from and the `API_VERSION` line it expects. Take `Code.gs` from that same commit.

## 4. Publish the site

1. Create a GitHub repository. It must be public for free GitHub Pages. The code holds no donor data, and the data stays in your private Sheet.
2. Push this folder to it. `.gitignore` keeps the `.xlsx` and `.docx` files out.
3. In the repository, go to **Settings → Pages → Source: GitHub Actions**.
4. **Settings → Secrets and variables → Actions → Variables**: add `VITE_SCRIPT_URL` (from step 3) and `VITE_GOOGLE_CLIENT_ID` (from step 2). Paste each value exactly, with no spaces. If either is missing or isn't the right kind of value (a `/dev` URL, say), every **Test and deploy** run stops at **Check the repository variables** with a message saying which one and where it comes from, and deploys nothing, so the live site stays as it was.
5. **Actions → Test and deploy → Run workflow**. When it finishes, the site is at `https://<user>.github.io/<repo>/`.

## Local development

Run `npm install`, then `npm run dev`, and open <http://localhost:5173/?demo>. Demo mode shows every screen with made-up donors, needs no Google sign-in, and never touches the Sheet.

Run the local site against the real Sheet only when a change can't be checked in demo mode. It works on live donor data, so undo the setup as soon as you're done:

1. Create `.env.local` (git-ignored) in the repo root:

   ```
   VITE_SCRIPT_URL=https://script.google.com/macros/s/…/exec
   VITE_GOOGLE_CLIENT_ID=….apps.googleusercontent.com
   ```

2. Add `http://localhost:5173` and `http://localhost` to the sign-in client's **Authorized JavaScript origins** (step 2.3). Google's sign-in setup guide asks for both when testing locally.
3. Run `npm run dev` and open <http://localhost:5173>.
4. When you're done, remove both `localhost` origins again.

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

## When the drive ends

The tracker runs one drive at a time. When a drive is over, do these as the organiser:

1. **Keep a final copy.** On **Summary**, press **Download .xlsx**. In the Sheet, also use **File → Make a copy**. Keep both somewhere safe.
2. **Cut the Allowlist down to yourself.** Everyone on it can still open the tracker, and download every donor's phone number, for as long as their row is there. Delete every row but your own.
3. **Archive the deployment only if the tracker won't be used again.** **Deploy → Manage deployments → Archive** turns the tracker off for everyone, you included, and its `/exec` URL never works again: another drive would need a new deployment and a new `VITE_SCRIPT_URL` (steps 3 and 4.4). If there may be another drive, leave it deployed. With only you on the Allowlist, it refuses everyone else.
4. **Decide when donors' phone numbers are deleted**, and note the date. When it comes, delete everything that holds them: the tabs named for the finished drive (see below), the copy from step 1, and every `.xlsx` downloaded during the drive. If the tracker isn't being reused, that can be the whole Sheet.

### Starting the next drive

Keep the same Sheet and deployment, so the site and its address carry on working. Do this when no one is using the tracker, since a save made halfway through can be lost:

1. For each of the **Pledges**, **Payments**, **Pledges history** and **Payments history** tabs, right-click the tab's name, choose **Duplicate**, and rename the copy (**Copy of Pledges**) with the drive's year, such as `Pledges 2026`. The app reads only the tabs named exactly `Pledges` and `Payments`, and keeps history only in `Pledges history` and `Payments history`, so it ignores the copies.
2. In each of those four original tabs, click the **2** at the left of row 2, hold **Shift** and click the number of the last row, then press **Delete** on the keyboard. That empties the rows. Never clear or delete row 1: the app reads the column names there, and stops loading and saving without them.
3. Set the new goal: **Edit goal** on the Summary, or the `goal` row on the **Settings** tab.
4. Put the new drive's volunteers back on the **Allowlist**.
5. Ask every volunteer to press **Refresh**, or reload the page, before adding anything. A page left open still shows the old drive until it reloads.

## Troubleshooting

| The app says | Likely cause and fix |
|---|---|
| *The server is not configured: set the CLIENT_ID script property* | The `CLIENT_ID` script property is missing or misnamed. Add it as in step 2.5, then try again. No redeploy is needed. |
| *This site and the server are set up with different Google sign-in IDs.* | The `CLIENT_ID` script property and the site's `VITE_GOOGLE_CLIENT_ID` hold different client IDs. Copy the Client ID from step 2.4 into whichever is wrong: the script property needs no redeploy, while a changed repository variable needs **Actions → Test and deploy → Run workflow** (step 4.5), and every open page must be reloaded to pick it up. A `Code.gs` older than this message says *Your sign-in has expired. Please sign in again.* on every attempt instead. |
| *Could not reach the tracker … may not allow access to "Anyone"*, or *The tracker sent back an unexpected page* | The deployment's **Who has access** isn't **Anyone**, or `VITE_SCRIPT_URL` isn't the `/exec` URL. Fix it under **Deploy → Manage deployments** (step 3). If the device really is offline, the message stops at "try again". |
| *… is not on the volunteer list* | That Google account isn't on the **Allowlist** tab. Add the email exactly, one per row (step 1.6), or sign in with the listed account. |
| *The 3rd column of the "Pledges" tab should be …* | A column was inserted, moved or deleted in that tab, or its header row was cleared (step 1.9). Undo it with **File → Version history**, or move a new column to the right of `updatedBy`. |
| *The "Pledges" tab is missing* | The tab was renamed or deleted. Rename it back, or restore a deleted one with **File → Version history**. Don't run `setup()` again: it adds a new, empty tab and leaves the records in the renamed one. |
| *The tracker's server is out of date. Organiser: redeploy Code.gs as a new version (see setup guide).* | The website was updated, but the deployed `Code.gs` is older (or from before `Code.gs` had an `API_VERSION`). Paste in the `Code.gs` from the commit the site was built from (the app's **Help → For the organiser → Setup and troubleshooting** names it) and deploy it as a **new version** (**Manage deployments → ✎ → New version**). Until then, adding a pledge or payment may fail with *Someone else deleted this row* or *Missing or malformed row id*. |
| *The tracker was updated. Reload this page to get the latest version.* | `Code.gs` is newer than the website this page is running: usually a page left open since before the site was updated. Reload the page; on a phone's home-screen app, close it fully and open it again. If a freshly opened page still says it, the site wasn't rebuilt: re-run **Actions → Test and deploy → Run workflow** (step 4.5). |

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
