import { HEALTH_LABELS, STATUS, WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, type HealthId, type Status } from '../engine';
import { SITE_API_VERSION, SITE_COMMIT } from '../version';
import { h, type Child } from './dom';
import { PAYMENT_HELP, PLEDGE_HELP } from './help';

type Inline = Child[];

// Every string the guide quotes, verbatim, so a test can fail when the app's wording drifts from the guide's.
const SAID = {
  offline: 'You are offline. Changes cannot be saved until the connection is back.',
  serverBehind: "The tracker's server is out of date. Organiser: redeploy Code.gs as a new version (see setup guide).",
  siteBehind: 'The tracker was updated. Reload this page to get the latest version.',
  network: 'Could not reach the tracker. Check your connection and try again.',
  httpError: 'The tracker answered with an error',
  busy: 'The tracker is busy. Try again in a moment.',
  serverError: 'Something went wrong on the server. Try again.',
  expired: 'Your sign-in has expired. Please sign in again.',
  signInIdsDiffer: 'This site and the server are set up with different Google sign-in IDs. Reload the page; if it keeps happening, tell the organiser.',
  cancelled: 'Sign-in was cancelled.',
  googleDidNotLoad: 'Google sign-in did not load. Check your connection and reload the page.',
  notOnList: 'is not on the volunteer list.',
  notOnListTitle: 'Not on the volunteer list',
  differentAccount: 'Use a different account',
  couldNotLoad: 'Could not load the tracker',
  notSetUp: 'Not set up yet',
  notConfigured: 'The server is not configured',
  unexpectedPage: 'The tracker sent back an unexpected page.',
  tabMissing: 'tab is missing.',
  columnChanged: 'The organiser needs to undo the change with Version history, or move new columns to the right of updatedBy.',
  conflict: 'Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.',
  deleted: 'Someone else deleted this row. Reload to see the latest list.',
  notANumber: 'Enter a number, e.g. 250.',
  negative: 'Enter an amount of 0 or more.',
  decimals: 'Use at most 2 decimal places.',
  noPhone: "Enter the donor's phone number.",
  pickMethod: 'Pick a method from the list.',
  duplicateHint: 'This phone number is already on the pledge for',
  discardPledge: 'Discard your changes to this pledge?',
  deletePledge: "Delete this pledge? The donor's payments stay on the Payments tab but will show as not matched.",
  deletePayment: 'Delete this payment? It will be removed from every total.',
  healthIntro: 'Every figure below should read 0. Anything higher needs a look.',
  methodTotal: 'Total (should match Payments Logged)',
  displayStale: 'Figures may be out of date — tap to reconnect',
  saving: 'Saving…',
  saved: 'Saved.',
  couldNotSave: "Couldn't save",
  couldNotDelete: "Couldn't delete",
  trackerMenu: 'Fundraiser tracker',
  newDriveMenu: 'Start a new drive…',
} as const;

export const QUOTED_MESSAGES: readonly string[] = Object.values(SAID);

const p = (...children: Inline) => h('p', {}, ...children);
const b = (text: string) => h('strong', {}, text);
const said = (text: string) => h('q', { class: 'help-quote' }, text);
const note = (...children: Inline) => h('p', { class: 'help-note' }, ...children);
const bullets = (...items: Inline[]) => h('ul', { class: 'help-list' }, ...items.map((item) => h('li', {}, ...item)));
const steps = (...items: Inline[]) => h('ol', { class: 'help-steps' }, ...items.map((item) => h('li', {}, ...item)));
const terms = (...entries: Array<[string | Node, ...Inline]>) =>
  h('dl', { class: 'help-terms' }, ...entries.flatMap(([term, ...description]) => [h('dt', {}, term), h('dd', {}, ...description)]));
const topic = (title: string, ...content: Child[]) => h('div', { class: 'help-topic' }, h('h3', { class: 'heading-md' }, title), ...content);

const STATUS_HELP: Record<Status, string> = {
  [STATUS.pending]: 'Nothing has been received from this donor yet.',
  [STATUS.partial]: 'Some money has come in, but less than the pledge.',
  [STATUS.paid]: 'The payments add up to the pledge exactly, to the cent.',
  [STATUS.overpaid]: 'The donor has given more than they pledged. Their Balance Due shows the extra as a credit.',
};
const STATUS_ORDER: readonly Status[] = [STATUS.pending, STATUS.partial, STATUS.paid, STATUS.overpaid];

// Keyed by HealthId so adding a check to the engine fails the typecheck until the guide explains it.
const HEALTH_HELP: Record<HealthId, { meaning: string; fix: Inline }> = {
  notMatched: {
    meaning: 'Payments whose Donor Name shows a ⚠ warning. That money is left out of Total received.',
    fix: ['Tap ', b('Show'), ', open each payment, and follow the fix for its warning (see above).'],
  },
  duplicates: {
    meaning: 'The same phone number is on more than one pledge, so that donor’s payments are counted once per row.',
    fix: ['Keep one pledge and delete the other. See ', b('Fix a donor entered twice'), ' in How to….'],
  },
  pledgeNoPhone: {
    meaning: 'A pledge has an amount but no phone number, so no payment can ever be matched to it.',
    fix: ['Open the pledge and add the donor’s phone number.'],
  },
  paymentIncomplete: {
    meaning: 'A payment has a phone number but no date, or no amount. A payment without an amount adds nothing to any total.',
    fix: ['Open the payment and fill in the missing date or amount. If it was entered by mistake, delete it.'],
  },
  futureDated: {
    meaning: 'A payment is dated after today. It is still counted, but it is usually a typo, such as the wrong year.',
    fix: ['Open the payment and correct the Date received.'],
  },
  predatesPledge: {
    meaning: 'A donor’s most recent payment is dated before their Date Pledged. One of the dates is probably wrong.',
    fix: ['Check the Date Pledged on the pledge and the dates on the donor’s payments, and correct whichever is wrong.'],
  },
  possibleDuplicatePayments: {
    meaning: 'Two or more payments share the same phone number, amount and date. That is often the same payment typed in twice, but two real installments of the same amount on the same day are possible — check, it may be fine.',
    fix: ['Open the payments. If one is a duplicate entry, delete it. If both are real, no change is needed.'],
  },
};

interface Problem {
  message: Inline;
  meaning: Inline;
  action: Inline;
}

const PROBLEMS: readonly Problem[] = [
  {
    message: [said(SAID.offline)],
    meaning: ['Your phone or computer has lost its internet connection. This shows as a strip under the top bar.'],
    action: ['Wait for the connection to come back. If a save failed meanwhile, press ', b('Reopen'), ' on its message and ', b('Save'), ' again. You can still read the screens.'],
  },
  {
    message: [said(SAID.serverBehind)],
    meaning: ['The app was updated, but the organiser has not yet updated the part of the tracker that runs on Google’s side (Code.gs) to match. This shows as a strip under the top bar. It is not something you caused.'],
    action: ['Tell the organiser. You can keep working, but until it is fixed a save may fail, sometimes with a message that does not fit, such as ', said(SAID.deleted), ' when you add a new pledge or payment. Keep a note of what you add, and enter again anything that did not save once the organiser has fixed it.'],
  },
  {
    message: [said(SAID.siteBehind)],
    meaning: ['A newer version of the tracker came out while this page was open. This shows as a strip under the top bar.'],
    action: ['Wait until no row shows ', said(SAID.saving), ', then reload the page with your browser’s reload button. If you opened the tracker from your home screen, close it completely and open it again.'],
  },
  {
    message: [said(SAID.network)],
    meaning: ['The save did not reach the shared sheet, usually because the connection dropped.'],
    action: ['Check your connection, then press ', b('Reopen'), ' on the message. The form comes back with everything you typed; press ', b('Save'), ' again.'],
  },
  {
    message: [said(`${SAID.httpError} (…). Try again.`)],
    meaning: ['Google’s servers had a hiccup.'],
    action: ['Press ', b('Reopen'), ' on the message, then ', b('Save'), ' again. If it keeps happening, tell the organiser.'],
  },
  {
    message: [said(SAID.busy)],
    meaning: ['Several volunteers saved at the same moment, and the tracker handles one save at a time.'],
    action: ['Wait a few seconds, press ', b('Reopen'), ' on the message, then ', b('Save'), ' again. Nothing was lost.'],
  },
  {
    message: [said(SAID.serverError)],
    meaning: ['Something unexpected happened on the tracker’s side.'],
    action: ['Press ', b('Reopen'), ' on the message, then ', b('Save'), ' again. If it keeps happening, tell the organiser.'],
  },
  {
    message: [said(SAID.expired)],
    meaning: ['Google sign-ins last about an hour. The tracker renews yours quietly, but sometimes it has to ask.'],
    action: ['Sign in again in the window that appears. The save carries on by itself once you are back.'],
  },
  {
    message: [said(SAID.signInIdsDiffer)],
    meaning: ['The tracker’s website and the part that runs on Google’s side (Code.gs) are set up for different Google sign-ins, usually because the organiser has just changed a setting. Signing in again will not fix it. This is not something you caused.'],
    action: ['Reload the page. If it still says this, tell the organiser, and include the exact message.'],
  },
  {
    message: [said(SAID.cancelled)],
    meaning: ['The Google sign-in window was closed before you finished signing in.'],
    action: ['Press ', b('Reopen'), ' on the message, then ', b('Save'), ', and complete the sign-in. The window will not pop up again on its own for about a minute.'],
  },
  {
    message: [said(SAID.googleDidNotLoad)],
    meaning: ['The Google sign-in button could not be fetched, usually because of a weak connection.'],
    action: ['Reload the page once your connection is steady.'],
  },
  {
    message: [b(SAID.notOnListTitle), ' — ', said(`your-email@example.com ${SAID.notOnList}`)],
    meaning: ['You signed in with a Google account that the organiser has not added to the volunteer list.'],
    action: ['Ask the organiser to add that email address, or press ', b(SAID.differentAccount), ' and sign in with the account they did add.'],
  },
  {
    message: [b(SAID.couldNotLoad)],
    meaning: ['The tracker could not fetch the pledges and payments when it opened. The reason is shown underneath.'],
    action: ['Press ', b('Try again'), '. If the reason mentions the server or the deployment, tell the organiser.'],
  },
  {
    message: [said(SAID.conflict)],
    meaning: ['Another volunteer saved a change to the same pledge or payment after you opened it, or the organiser corrected it in the sheet.'],
    action: ['Press ', b('Reload'), ', open the row again, look at their change, and redo yours if it is still needed.'],
  },
  {
    message: [said(SAID.deleted)],
    meaning: ['Another volunteer deleted the row you were editing. If you were adding a new pledge or payment instead, the tracker’s server is out of date (a strip under the top bar says so) and your entry was not saved.'],
    action: ['Press ', b('Reload'), '. If the row should still exist, do not add it again: ask the organiser to bring it back, then make your change. If you were adding a new one, tell the organiser, and add it again once they have fixed the server.'],
  },
  {
    message: [b(SAID.notSetUp), ', ', said(`${SAID.notConfigured}…`), ', ', said(SAID.unexpectedPage), ' or ', said(`The "…" ${SAID.tabMissing} …`)],
    meaning: ['The tracker itself is not set up correctly. This is not something you caused.'],
    action: ['Tell the organiser, and include the exact message.'],
  },
  {
    message: [said(`The 3rd column of the "Pledges" tab should be "name" but is "Email". ${SAID.columnChanged}`)],
    meaning: ['Someone added, moved or deleted a column in the Google Sheet behind the tracker. The tracker stops loading and saving until it is put back, so it never shows wrong totals or saves over the new column. This is not something you caused.'],
    action: ['Tell the organiser, and include the exact message. Once the sheet is fixed, the tracker works again; redo any save that failed meanwhile.'],
  },
];

function problemTable(): HTMLElement {
  const cell = (label: string, content: Inline) => h('td', { 'data-label': label }, ...content);
  return h(
    'table',
    { class: 'help-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'The app says'), h('th', { scope: 'col' }, 'What it means'), h('th', { scope: 'col' }, 'What to do'))),
    h('tbody', {}, ...PROBLEMS.map((problem) => h('tr', {}, cell('The app says', problem.message), cell('What it means', problem.meaning), cell('What to do', problem.action)))),
  );
}

function gettingStarted(): Child[] {
  return [
    p('The tracker keeps the masjid’s fundraiser records in one shared place, so every volunteer sees the same numbers.'),
    terms(
      [b('Pledges'), 'The promises. One row per donor: who they are and how much they promised to give.'],
      [b('Payments'), 'The money that actually came in. One row for every payment, so a donor paying in three installments has three rows.'],
      [b('Summary'), 'The totals, worked out for you from the other two. You never type anything here except the goal.'],
    ),
    note('A pledge is a promise; a payment is money in hand. The tracker links them by the donor’s phone number.'),
    topic(
      'Signing in',
      steps(
        ['Open the tracker’s web address.'],
        ['Press the ', b('Sign in with Google'), ' button and choose your Google account.'],
        ['The Summary opens. Your email address shows at the top of the page on a computer.'],
      ),
      p('Only people on the organiser’s volunteer list can open the tracker. If you see ', b(SAID.notOnListTitle), ', see ', b('When something goes wrong'), '.'),
    ),
    topic(
      'Put it on your phone’s home screen',
      p('The tracker works in your phone’s web browser. Adding it to your home screen gives you the ICG icon to tap, like an app, instead of a browser tab.'),
      terms(
        [b('iPhone (Safari)'), 'Tap the ', b('Share'), ' button (the square with an arrow), scroll down, and tap ', b('Add to Home Screen'), '.'],
        [b('Android (Chrome)'), 'Tap the ', b('⋮'), ' menu at the top right, then ', b('Add to Home screen'), ' or ', b('Install app'), '.'],
      ),
    ),
    topic(
      'Light and dark',
      p('Press ', b('Dark mode'), ' at the top of the page for a darker screen that is easier on the eyes at night. Press ', b('Light mode'), ' to switch back. Your choice is remembered on that device.'),
    ),
    topic(
      'Signing out',
      p('On a shared or borrowed device, press ', b('Sign out'), ' when you finish, so the next person cannot see donor details. On your own phone you can stay signed in.'),
    ),
  ];
}

function theScreens(): Child[] {
  return [
    p('Move between screens with the tabs at the top: ', b('Summary'), ', ', b('Pledges'), ', ', b('Payments'), ', ', b('Find donor'), ' and ', b('Help'), '.'),
    topic(
      'Summary',
      bullets(
        [b('Goal'), ' — how much has been received against the fundraiser goal, with a progress bar. ', b('Edit goal'), ' changes the target.'],
        [b('The four totals'), ' — Total pledged, Total received, Balance outstanding, and Overpaid / credit. ', b('Understanding the numbers'), ' explains each one.'],
        [b('Donors'), ' — how many donors have pledged, and how many are Fully paid, Partial, Pending or Overpaid.'],
        [b('Reconciliation'), ' — Payments logged (every payment typed in) next to Unmatched payments (money not counted toward any pledge). Unmatched should be $0.00; the card turns amber when it is not.'],
        [b('Data health'), ' — seven checks. ', said(SAID.healthIntro), ' The last one is a prompt to double-check rather than a certain problem. Tap ', b('Show'), ' next to a check to see just the rows it found. A note under the checks says when the shared sheet has rows that are not counted because they have no id; only the organiser can fix those.'],
        [b('Collected by payment method'), ' — a chart and table of money by Cash, Card and so on. Payments with no method appear as ', b('No method recorded'), '. The last row, ', said(SAID.methodTotal), ', should equal Payments logged.'],
        [b('Download .xlsx'), ' — saves the pledges, payments and totals as an Excel file: a readable record for the treasurer.'],
        [b('Friday display'), ' — a full-screen view of the fundraiser for the projector. See ', b('Show the fundraiser on the projector'), ' in How to….'],
      ),
    ),
    topic(
      'Pledges',
      p('One row per donor. You type the ', b('Phone Number'), ', ', b('Donor Name'), ', ', b('Date Pledged'), ', ', b('Amount Pledged'), ' and ', b('Notes'), '. The tracker works out the rest from the Payments screen: ', b('Last Payment'), ', ', b('Received'), ', ', b('Balance Due'), ', ', b('# Payments'), ' and ', b('Status'), '.'),
      bullets(
        ['The line above the table shows the running totals: pledged, received, outstanding and number of payments.'],
        [b('Red rows'), ' are donors listed more than once. Their payments are being counted twice until you fix it.'],
        ['A faded row marked ', said(SAID.saving), ' is still being saved. It cannot be opened until the save finishes, usually within a few seconds.'],
        ['Tap any row to edit or delete it.'],
        [
          b('Pending'),
          ', ',
          b('Partial'),
          ', ',
          b('Paid'),
          ' and ',
          b('Overpaid'),
          ' chips filter to that status. ',
          b('Needs follow-up'),
          ' finds Pending or Partial donors with no pledge or payment activity in the last 30 days, biggest balance first.',
        ],
      ),
    ),
    topic(
      'Payments',
      p('One row per payment. You type the ', b('Phone Number'), ', ', b('Date Received'), ', ', b('Amount'), ', ', b('Method'), ' and ', b('Notes'), '. The ', b('Donor Name'), ' is filled in for you by matching the phone number to a pledge.'),
      bullets(
        [b('Red rows'), ' with a ', b('⚠'), ' in Donor Name are payments that are not being counted. ', b('Warnings and data health'), ' explains why and how to fix them.'],
        [b('An amber date'), ' is a date in the future, which is usually a typo.'],
        ['The coloured label in the Method column shows how the money was paid.'],
        [b('From'), ' and ', b('To'), ' filter to payments received in that range; either can stay blank. Payments with no date drop out once a bound is set. ', b('Clear dates'), ' removes the range.'],
      ),
    ),
    topic(
      'Find donor',
      p('Type a donor’s full phone number, in any format, or part of their name. A phone number takes you straight to the donor; a name shows a list to choose from.'),
      p('The donor card shows their pledge, what they have paid, their balance and status, and every payment they have made.'),
    ),
    topic(
      'Search and sort',
      bullets(
        ['The search box on Pledges and Payments looks through phone numbers, names and notes (and the method, on Payments). Part of a phone number works too. Clear the box to see everything again.'],
        ['Tap a column heading to sort by it. Tap it again to reverse the order.'],
        [
          'On Pledges, the ',
          b('Pending'),
          ', ',
          b('Partial'),
          ', ',
          b('Paid'),
          ' and ',
          b('Overpaid'),
          ' chips filter to that status. ',
          b('Needs follow-up'),
          ' finds Pending or Partial donors with no pledge or payment activity in the last 30 days, biggest balance first.',
        ],
        [
          'On Payments, ',
          b('From'),
          ' and ',
          b('To'),
          ' filter to payments received in that range; either can stay blank. Payments with no date drop out once a bound is set. ',
          b('Clear dates'),
          ' removes the range.',
        ],
        ['Search, the status chips (Pledges) and the date range (Payments) all narrow the list together. A “Showing N of M” line appears whenever any of them is doing something.'],
        ['A long list only shows the first 100 rows at a time, with a ', b('Show more (N left)'), ' button underneath to reveal the rest. Search, sort and the filters above always look through every row, not just the ones on screen — narrowing the list can bring a row back within the first 100 even if you have not pressed Show more.'],
        ['Tapping ', b('Show'), ' next to a Data-health check on Summary clears any active status chips or date range first, so the flagged rows it found are never hidden behind a filter left over from before.'],
      ),
    ),
    topic(
      'On a phone',
      p('On a narrow screen each row becomes a small card, with the column name on the left of every value. Everything works the same way: tap a card to open it.'),
    ),
  ];
}

function howTo(): Child[] {
  return [
    topic(
      'Record a new pledge',
      steps(
        ['Go to ', b('Pledges'), ' and press ', b('Add pledge'), '.'],
        ['Fill in the form. What goes in each box is listed below, and the same hint shows under the box.'],
        ['Press ', b('Save'), '. The form closes at once and the new row appears, marked ', said(SAID.saving), ' for a few seconds. Then ', said(SAID.saved), ' appears at the bottom of the screen.'],
      ),
      terms(
        ['Phone number', PLEDGE_HELP.phone],
        ['Donor name', PLEDGE_HELP.name],
        ['Date pledged', PLEDGE_HELP.datePledged],
        ['Amount pledged ($)', PLEDGE_HELP.amountPledged],
        ['Notes', PLEDGE_HELP.notes],
      ),
      note('If the phone number is already on another pledge, an amber note appears: ', said(`${SAID.duplicateHint} …`), ' Do not save a second pledge for the same donor — edit the existing one instead.'),
    ),
    topic(
      'Log a payment',
      steps(
        ['Go to ', b('Payments'), ' and press ', b('Log a payment'), '.'],
        ['Type the donor’s phone number. Just under it, the tracker shows who it found, for example “Donor: Aisha Rahman”. If it shows a ⚠ warning instead, the payment will not be counted — check the number before saving.'],
        ['Check the date (it starts as today), type the amount, and pick the payment method. The boxes are explained below.'],
        ['Press ', b('Save'), '.'],
      ),
      terms(
        ['Phone number', PAYMENT_HELP.phone],
        ['Date received', PAYMENT_HELP.dateReceived],
        ['Amount received ($)', PAYMENT_HELP.amountReceived],
        ['Payment method', PAYMENT_HELP.method],
        ['Notes', PAYMENT_HELP.notes],
      ),
      note('Log each installment as its own payment. Do not edit an old payment to add a new amount to it — the tracker adds up the installments for you.'),
      note(
        'You can also log a payment straight from a donor: open their card on ',
        b('Find donor'),
        ', or tap their pledge on ',
        b('Pledges'),
        ', and press ',
        b('Log a payment'),
        ' there — the phone number is filled in for you. If you were mid-edit on the pledge, the tracker asks ',
        said(SAID.discardPledge),
        ' first, so you don’t lose typing you meant to keep.',
      ),
    ),
    topic(
      'Record a pledge when the amount isn’t known yet',
      p('Sometimes a donor promises to give but has not said how much. Enter ', b('0'), ' in Amount pledged — do not leave it blank.'),
      bullets(
        [b('With 0'), ', the donor’s payments count toward Total received and the goal. Once they pay, their status shows Overpaid until you type in the real amount. That is expected.'],
        [b('Left blank'), ', the donor’s payments show ', said(WARN_NO_AMOUNT), ' and do not count toward Total received or the goal until the amount is filled in. Until then they show up in Unmatched payments.'],
      ),
      p('When you learn the amount, edit the pledge and replace the 0.'),
    ),
    topic(
      'Edit a pledge or payment',
      steps(['Find the row on Pledges or Payments (use the search box).'], ['Tap the row. The form opens with its current values.'], ['Change what you need and press ', b('Save'), '.']),
    ),
    topic(
      'Delete a pledge or payment',
      steps(['Tap the row to open it.'], ['Press ', b('Delete'), ' at the bottom left of the form.'], ['Read the question and press ', b('Delete'), ' again to confirm. The row disappears at once.']),
      bullets(
        ['Deleting a payment asks: ', said(SAID.deletePayment)],
        ['Deleting a pledge asks: ', said(SAID.deletePledge)],
      ),
      note('There is no undo button. If you delete something by mistake, do not add it again: ask the organiser to bring the row back. The tracker keeps a copy of every deleted row for them.'),
    ),
    topic(
      'Fix a payment typed with the wrong phone number',
      p('The payment shows ', said(WARN_NOT_IN_PLEDGES), ' and a red row.'),
      steps(
        ['On ', b('Payments'), ', tap the red row.'],
        ['Correct the phone number. The line under it should now show “Donor:” and the right name.'],
        ['Press ', b('Save'), '. The row turns normal and the money counts again.'],
      ),
      p('If the phone number was right but the donor has no pledge yet, add a pledge for them with that number instead.'),
    ),
    topic(
      'Handle a donor who paid more than they pledged',
      p('Their status shows ', b(STATUS.overpaid), ' and their Balance Due is shown in brackets, for example ($50.00).'),
      steps(
        ['First check their payments for a typo, such as 500 typed instead of 50. Fix it if so.'],
        ['If the donor really did give more, you can raise their Amount pledged to match, or leave it. Either is fine — ask the organiser which they prefer.'],
      ),
      p('The extra money is shown under ', b('Overpaid / credit'), ' on the Summary. It never hides what other donors still owe.'),
    ),
    topic(
      'Fix a donor entered twice',
      p('Both rows turn red on Pledges, and Data health shows ', said(HEALTH_LABELS.duplicates), '. Until you fix it, that donor’s payments are counted twice.'),
      steps(
        ['On ', b('Summary'), ', tap ', b('Show'), ' next to ', b(HEALTH_LABELS.duplicates), ' to see just those rows.'],
        ['Decide which row to keep. Open it and make it complete: the correct amount (add the two together if they really were two separate promises), the name, and any notes from the other row. Save.'],
        ['Open the other row and delete it.'],
      ),
      note('You do not need to move any payments. They match by phone number, so they stay with the pledge you kept — even though the delete question says they will show as not matched.'),
    ),
    topic(
      'Change the fundraiser goal',
      steps(['On ', b('Summary'), ', press ', b('Edit goal'), ' in the Goal card.'], ['Type the new goal and press ', b('Save'), '.']),
    ),
    topic(
      'Show the fundraiser on the projector',
      steps(
        ['Sign in on the computer connected to the projector.'],
        ['On ', b('Summary'), ', press ', b('Friday display'), '.'],
        ['Make the browser full screen (F11 on most computers).'],
      ),
      p('The screen shows the drive’s name (or just “Fundraiser” until the organiser sets one), the amount received, the goal, the percentage and how many donors have pledged. It never shows a donor’s name, phone number or amount.'),
      p('It updates itself every few minutes and shows the time of the last update. It never asks anyone to sign in on its own, so a sign-in box will not pop up in the middle of an announcement.'),
      p('If a sign-in box appears when you press ', b('Friday display'), ', sign in: your sign-in was about to run out, and signing in now keeps the screen updating for about another hour.'),
      note('Google sign-ins last about an hour. After that the figures stop updating, and after 15 minutes a small note says ', said(SAID.displayStale), '. Tap it and sign in to bring the figures up to date. Press ', b('Exit'), ' in the top corner to go back to the Summary.'),
      bullets(
        [b('Sign in first'), ' — sign in on the projector computer before the khutbah starts, not during it, so the screen has a fresh hour and nothing interrupts the display.'],
        [b('Keep the laptop awake'), ' — turn off sleep and screen-lock (or plug it in and disable auto-sleep) for the computer driving the projector, so the display does not go dark on its own.'],
      ),
    ),
    topic(
      'Download a copy',
      steps(
        ['On ', b('Summary'), ', press ', b('Download .xlsx'), '.'],
        ['Your device saves a file named like ICG-Fundraiser-2026-09-24.xlsx, with Pledges, Payments and Summary sheets.'],
      ),
      p('The file is a snapshot of that moment. Changes made afterwards are not in it.'),
    ),
    topic(
      'See only the problem rows',
      steps(
        ['On ', b('Summary'), ', look at Data health. Any check above 0 has a ', b('Show'), ' button.'],
        ['Tap ', b('Show'), '. The tracker opens Pledges or Payments showing only those rows, with a “Showing: …” label at the top.'],
        ['Fix the rows. When you are done, tap the “Showing: … ×” label to see the full list again.'],
      ),
    ),
  ];
}

function theNumbers(): Child[] {
  return [
    topic('Status', terms(...STATUS_ORDER.map((status): [Node, ...Inline] => [b(status), STATUS_HELP[status]])), p('A pledge with no amount has no status until the amount is filled in.')),
    topic(
      'Balance Due',
      p('Amount Pledged minus Received, for one donor. A negative balance is a credit: the donor has given more than they pledged. The tracker shows negative money in brackets, so ($50.00) means a $50 credit.'),
    ),
    topic(
      'The Summary totals',
      terms(
        [b('Total pledged'), 'Every Amount Pledged added together.'],
        [b('Total received'), 'Money matched to a pledge. Payments with a ⚠ warning are not included.'],
        [b('Balance outstanding'), 'Only the money donors still owe. A donor’s credit is never subtracted from another donor’s debt.'],
        [b('Overpaid / credit'), 'All the extra money from donors who gave more than they pledged, shown separately.'],
        [b('Donors: Pledged'), 'Donors with an Amount Pledged above 0.'],
      ),
    ),
    topic(
      'Payments logged and Unmatched payments',
      p(b('Payments logged'), ' is every amount on the Payments screen. ', b('Total received'), ' is the part of that money matched to a pledge. The difference is ', b('Unmatched payments'), ', and it should be $0.00.'),
      bullets(
        ['Above $0.00 means some payments are not counted toward any pledge — look for ⚠ rows.'],
        ['Below $0.00 usually means a donor is listed twice, so their payments are counted twice.'],
      ),
    ),
    topic(
      '% of goal received',
      p('Total received divided by the goal. Only money matched to a pledge counts, so fixing ⚠ payments can raise it.'),
    ),
    topic(
      'Phone numbers',
      p('The phone number is how a payment finds its donor. Dashes, spaces, brackets, dots and the + sign are ignored, so 555-010-0101, (555) 010 0101 and 5550100101 are the same donor.'),
      p('Digits are never ignored. ', b('0551234'), ' and ', b('551234'), ' are different numbers, and so are ', b('+1 555 010 0101'), ' and ', b('555 010 0101'), '. Type a donor’s number the same way every time.'),
    ),
  ];
}

function warningsAndHealth(): Child[] {
  return [
    topic(
      'The two warnings',
      p('A payment that is not being counted shows a warning in its Donor Name, and its row turns red.'),
      terms(
        [said(WARN_NOT_IN_PLEDGES), 'No pledge has this phone number. Usually the number was mistyped on the payment or the pledge. Correct it — or, if the donor has no pledge yet, add one.'],
        [said(WARN_NO_AMOUNT), 'The donor’s pledge has a blank Amount Pledged. Open the pledge and enter the amount, or 0 if it is not known yet.'],
      ),
    ),
    topic(
      'Colours on the lists',
      terms(
        [b('Red row on Pledges'), 'The donor is listed more than once.'],
        [b('Red row on Payments'), 'The payment is not counted (it has a ⚠ warning).'],
        [b('Amber date on Payments'), 'The payment is dated in the future.'],
      ),
    ),
    topic(
      'The seven data-health checks',
      p('The first six should read 0. When one does not, tap ', b('Show'), ' to see the rows, then fix them as described below. The last, ', b(HEALTH_LABELS.possibleDuplicatePayments), ', can be a false alarm — see below.'),
      h(
        'dl',
        { class: 'help-terms' },
        ...(Object.keys(HEALTH_LABELS) as HealthId[]).flatMap((id) => [
          h('dt', { 'data-health': id }, b(HEALTH_LABELS[id])),
          h('dd', {}, p(HEALTH_HELP[id].meaning), p(b('Fix: '), ...HEALTH_HELP[id].fix)),
        ]),
      ),
      note('The “predate” check only compares each donor’s latest payment with their pledge date. One wrong date among several payments may not be caught, so it is worth a glance when you enter old payments.'),
    ),
  ];
}

function workingTogether(): Child[] {
  return [
    bullets(
      ['Several volunteers can use the tracker at the same time, on any mix of phones and computers.'],
      ['Every save goes straight to the shared sheet. There is no separate “publish” step.'],
      ['You see other volunteers’ changes when you press ', b('Refresh'), ' at the top of the page. The tracker also refreshes by itself when you come back to it after 2 minutes or more away.'],
      ['The form closes as soon as you press Save, and the row shows ', said(SAID.saving), ' for a few seconds while it reaches the shared sheet — longer on a slow connection. You can carry on with the next entry meanwhile. If Google’s servers hiccup, the tracker quietly retries on its own — you do not need to do anything unless you actually see an error message.'],
    ),
    topic(
      'When two people change the same row',
      p('The tracker never silently overwrites someone else’s edit. If another volunteer saved a change to a row after you opened it, or the organiser corrected it in the sheet, your save stops and you see the message below, starting with what you were saving. If you are already typing in another form, it waits until you close that form:'),
      p(said(SAID.conflict)),
      steps(['Press ', b('Reload'), '.'], ['Open the row again and look at what changed.'], ['Make your change again if it is still needed.']),
      p('If you reopen a save that seemed to fail and press Save again, the tracker checks whether the first one actually went through. If it did, nothing is added twice. If the saved values differ from what you are sending, you see the same message — reload and check the row.'),
    ),
  ];
}

function whenSomethingGoesWrong(): Child[] {
  return [
    p('Most problems are a dropped connection. When a save fails, a red message appears at the bottom of the screen, starting ', said(`${SAID.couldNotSave} …`), ' and saying what was being saved — the donor’s name (or phone number) for a pledge, “the payment from” and the phone number for a payment, or “the goal” — followed by one of the messages below. The row goes back to how it was.'),
    p('Press ', b('Reopen'), ' on that message: the form comes back with everything you typed, and you can press ', b('Save'), ' again; saving it this way never adds the row twice. Press Reopen before the message goes: it stays for 30 seconds (longer while you have another form open), or until you press ', b('Dismiss'), '. If it has gone, check the list first — do not add the row again from scratch without looking, or it may end up there twice.'),
    p('A delete that fails shows ', said(`${SAID.couldNotDelete} …`), ' and the row comes back. Open it and delete it again.'),
    problemTable(),
    topic(
      'Messages inside a form',
      p('These appear in red under a box when something in it needs fixing. Correct the box and press Save again.'),
      bullets([said(SAID.notANumber)], [said(SAID.negative)], [said(SAID.decimals)], [said(SAID.noPhone)], [said(SAID.pickMethod)]),
    ),
  ];
}

function forTheOrganiser(): Child[] {
  return [
    p('These tasks happen in the Google Sheet behind the tracker, not in the app.'),
    topic(
      'Volunteers',
      p('Add each volunteer’s Google email address to the ', b('Allowlist'), ' tab, one per row, in the first column. To remove someone, delete their row. The change takes effect the next time they do anything in the tracker.'),
      p('To remember whose address is whose, you can type each volunteer’s name in the second column, next to their email. The tracker reads only the first column.'),
    ),
    topic(
      'Payment methods, the goal and the drive’s name',
      p('The ', b('Settings'), ' tab has one setting per row. ', b('paymentMethods'), ' is the list volunteers pick from, separated by commas — for example Cash,Bank Transfer,Card,Check,Online,Other. ', b('goal'), ' is the fundraiser target; volunteers can also change it with ', b('Edit goal'), ' on the Summary.'),
      p(
        b('campaignName'),
        ' is the title of the Friday display, such as Masjid Expansion 2026. Left blank, the display says Fundraiser. If the tab has no campaignName row, add one: campaignName in the first column and the name in the second.',
      ),
      p('Volunteers see changes to Settings after pressing Refresh. Payments that use a method you removed are grouped as “Other / unlisted” on the Summary, and must be given a listed method the next time someone edits them.'),
    ),
    topic(
      'Keeping the sheet healthy',
      bullets(
        ['Do not format the Pledges or Payments columns as ', b('Plain text'), '. Leave them on Automatic, or phone numbers and dates get corrupted.'],
        [
          'Add pledges and payments through the app. A row typed or pasted into the sheet with a blank ',
          b('id'),
          ' (the first column) is left out of every total and list, so a totals or notes row under the data does no harm. When such rows look like real pledges or payments, the Summary says how many, under Data health.',
        ],
        [
          'To bring those rows in, give each one an id no other row uses. Type a new word and a number in the id column of the first row, such as dinner1, then drag the small square at the corner of that cell down the batch to fill in dinner2, dinner3 and so on. Use a different word for each batch.',
        ],
        [
          'You can correct a pledge or payment directly in the sheet. The tracker marks the row as changed, filling in ',
          b('updatedAt'),
          ' and ',
          b('updatedBy'),
          ' for you, so a volunteer who opened it before your fix is asked to reload instead of saving the old values over it. Rows brought in with ',
          b('File → Import'),
          ' are not marked, so do not use Import to change rows.',
        ],
        [
          'Add your own columns to Pledges or Payments only to the right of the last one, ',
          b('updatedBy'),
          '. Do not rename, move or delete the existing columns, and do not rename or delete the tabs. Otherwise the tracker stops loading and saving until the change is undone; ',
          b('Version history'),
          ' is the quickest way.',
        ],
      ),
    ),
    topic(
      'Bring back a deleted or changed row',
      p(
        'Whenever a volunteer edits or deletes a pledge or payment, the tracker first copies the old row to the ',
        b('Pledges history'),
        ' or ',
        b('Payments history'),
        ' tab. The last three columns say when (',
        b('changedAt'),
        '), who (',
        b('changedBy'),
        ') and whether it was an ',
        b('edit'),
        ' or a ',
        b('delete'),
        ' (',
        b('action'),
        ').',
      ),
      steps(
        ['Find the row in the history tab. The newest are at the bottom.'],
        ['Select its first 8 cells, from ', b('id'), ' to ', b('updatedBy'), ', and copy them. Leave out the last three.'],
        ['For a deleted row, paste them into the first empty row of the Pledges or Payments tab. For an edited row, paste them over the row with the same id instead, or it will be counted twice.'],
        ['The row keeps its id, so volunteers see it after pressing ', b('Refresh'), '.'],
      ),
      p(
        'If the history tabs do not have it (a change from before they existed, or one made directly in the sheet), open ',
        b('File → Version history → See version history'),
        ', click a version from before the mistake, copy the row’s first 8 cells there, then go back to the current sheet and paste them in the same way.',
      ),
      note(
        'Do not press ',
        b('Restore this version'),
        ' to get a row back. It rolls back the whole sheet, so every pledge and payment any volunteer entered or changed since that version is lost.',
      ),
      p('The history tabs keep deleted rows, phone numbers included. To remove a donor’s details for good, delete their rows from the history tab too.'),
    ),
    topic(
      'Data safety routine',
      p('The Sheet is the only copy of the fundraiser’s records. A little routine protects it.'),
      bullets(
        [
          b('Bring back one row at a time'),
          ' — copy it from a history tab or an old version, as described above, instead of pressing ',
          b('Restore this version'),
          ', which undoes every volunteer’s work since that version.',
        ],
        [
          b('Add a second editor'),
          ' — share the Sheet with a second trusted person as an ',
          b('Editor'),
          ' (not just Viewer), so the fundraiser’s records are never locked to one person’s Google account.',
        ],
        [
          b('Keep a copy of the Sheet'),
          ' — once a month and again right after each event, the second editor opens the Sheet and uses ',
          b('File → Make a copy'),
          ', naming the copy with the date, such as ICG backup 2026-09-24. The copy stays in their own Google Drive and keeps every tab (Settings and the Allowlist too) and the tracker’s script, so the tracker can be set up again from it if the Sheet is ever lost. docs/SETUP.md explains how.',
        ],
        [
          b('Download .xlsx'),
          ' on the Summary is a readable record for the treasurer, not the backup. The tracker cannot be set up again from it.',
        ],
        [b('Never delete the Sheet or its Apps Script project'), ' — that is the tracker’s only database; deleting either takes every pledge and payment with it.'],
      ),
    ),
    topic(
      'When the drive ends',
      p('The tracker runs one drive at a time. When a drive is over:'),
      steps(
        [
          b('Keep a final copy'),
          ' — in the sheet, use ',
          b('File → Make a copy'),
          ', named for the drive, such as ICG final 2026. For the treasurer, also press ',
          b('Download .xlsx'),
          ' on ',
          b('Summary'),
          ': a readable record of the final figures, not a backup.',
        ],
        [
          b('Take everyone else off the Allowlist'),
          ' — everyone on it can still open the tracker and see every donor’s phone number, for as long as their row is there. Delete every row except your own.',
        ],
        [
          b('Switch the tracker off only if it will never be used again'),
          ' — in Apps Script, ',
          b('Deploy → Manage deployments → Archive'),
          '. Its web address then stops working for good, so another drive would need the tracker set up again. If there may be another drive, leave it on: with only you on the Allowlist, nobody else can get in.',
        ],
        [
          b('Decide when donors’ phone numbers are deleted'),
          ' — and note the date. When it comes, delete everything that holds them: the tabs named for the finished drive (see below), every copy of the sheet, and every downloaded .xlsx file. Deleting a tab does not take it out of the sheet’s ',
          b('Version history'),
          ', whose older versions still hold the numbers, and only deleting the whole sheet removes those. So if the tracker will not be used again, delete the whole sheet.',
        ],
      ),
    ),
    topic(
      'Starting the next drive',
      p('Keep the same sheet, so the tracker’s web address carries on working. Do this when no one is using the tracker.'),
      steps(
        [
          'In the sheet, choose ',
          b(`${SAID.trackerMenu} → ${SAID.newDriveMenu}`),
          ' from the menu bar, type a name for the finished drive, such as 2026, and press OK. It copies the ',
          b('Pledges'),
          ', ',
          b('Payments'),
          ', ',
          b('Pledges history'),
          ' and ',
          b('Payments history'),
          ' tabs into new tabs named like Pledges 2026, then empties the four originals, keeping row 1. The tracker only uses the tabs with exactly those four names, so it ignores the copies.',
        ],
        ['Set the new goal with ', b('Edit goal'), ' on the Summary, and the new drive’s name in the ', b('campaignName'), ' row of the Settings tab.'],
        ['Put the new drive’s volunteers back on the Allowlist.'],
        ['Ask every volunteer to press ', b('Refresh'), ' before adding anything. A page left open still shows the old drive until it reloads.'],
      ),
      p(
        'To do the first step by hand instead, do this for each of the four tabs: right-click the tab’s name, choose ',
        b('Duplicate'),
        ', and rename the copy with the drive’s name, such as Pledges 2026. Then, in the original tab, click the 2 at the left of row 2, hold Shift and click the number of the last row, and press Delete on the keyboard, which empties the rows. Make sure no one is using the tracker, since a save made halfway through can be lost.',
      ),
      note('Never clear or delete row 1, the row of column names. Without it, the tracker stops loading and saving.'),
    ),
    topic(
      'Setup and troubleshooting',
      p('Setting the tracker up, and fixing setup problems, is covered in docs/SETUP.md in the project’s GitHub repository.'),
      p(
        'This copy of the app ',
        ...(SITE_COMMIT === '' ? ['is a local build'] : ['was built from commit ', b(SITE_COMMIT)]),
        '. It works with the Code.gs that contains the line ',
        b(`const API_VERSION = ${SITE_API_VERSION};`),
        '. Mention both when you report a problem.',
      ),
    ),
  ];
}

export const HELP_SECTIONS = [
  { id: 'help-start', title: 'Getting started', body: gettingStarted },
  { id: 'help-screens', title: 'The screens', body: theScreens },
  { id: 'help-how-to', title: 'How to…', body: howTo },
  { id: 'help-numbers', title: 'Understanding the numbers', body: theNumbers },
  { id: 'help-warnings', title: 'Warnings and data health', body: warningsAndHealth },
  { id: 'help-together', title: 'Working together', body: workingTogether },
  { id: 'help-problems', title: 'When something goes wrong', body: whenSomethingGoesWrong },
  { id: 'help-organiser', title: 'For the organiser', body: forTheOrganiser },
] as const;

export function createHelpView(): HTMLElement {
  const sections = HELP_SECTIONS.map((section, index) =>
    h('details', { class: 'help-section', id: section.id, open: index === 0 }, h('summary', { class: 'help-summary' }, h('h2', { class: 'help-heading' }, section.title)), h('div', { class: 'help-body' }, ...section.body())),
  );

  const toc = h(
    'nav',
    { class: 'help-toc', 'aria-label': 'Contents' },
    h('p', { class: 'eyebrow' }, 'Contents'),
    h(
      'ol',
      {},
      ...HELP_SECTIONS.map((section, index) => {
        const link = h('a', { href: `#${section.id}` }, section.title);
        // The URL hash is the app's router; following the anchor would leave the Help screen.
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const target = sections[index];
          target.open = true;
          target.scrollIntoView({ block: 'start' });
          target.querySelector('summary')?.focus({ preventScroll: true });
        });
        return h('li', {}, link);
      }),
    ),
  );

  const view = h(
    'section',
    { class: 'view help-guide' },
    h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'User guide'), h('h1', { class: 'display-md' }, 'How to use the tracker'))),
    h('p', { class: 'help-lede' }, 'Plain answers for volunteers. Tap a heading to open it, or jump straight to a topic below.'),
    toc,
    ...sections,
  );

  // Closed <details> print as a bare heading; open them all for paper, then put them back.
  let openBeforePrint: boolean[] | null = null;
  window.addEventListener('beforeprint', () => {
    if (!view.isConnected) return;
    openBeforePrint = sections.map((section) => section.open);
    sections.forEach((section) => { section.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (!openBeforePrint) return;
    const previous = openBeforePrint;
    sections.forEach((section, index) => { section.open = previous[index]; });
    openBeforePrint = null;
  });
  return view;
}
