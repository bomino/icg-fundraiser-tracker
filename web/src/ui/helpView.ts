import { HEALTH_LABELS, STATUS, WARNING_MARK, WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, type HealthId, type Status } from '../engine';
import { MAX_TEXT } from '../validate';
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
  stillLoading: 'Still loading — the shared sheet can take up to 20 seconds. Please keep this page open.',
  notSetUp: 'Not set up yet',
  notConfigured: 'The server is not configured',
  unexpectedPage: 'The tracker sent back an unexpected page.',
  tabMissing: 'tab is missing.',
  columnChanged: 'The organiser needs to put the columns back as they were, or move a new column to the right of updatedBy.',
  conflict: 'Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.',
  deleted: 'Someone else deleted this row. Reload to see the latest list.',
  alreadySavedDifferent: 'This entry was already saved with different values. Reopen it to check.',
  notANumber: 'Enter a number, e.g. 250.',
  negative: 'Enter an amount of 0 or more.',
  decimals: 'Use at most 2 decimal places.',
  tooLarge: 'That amount is too large.',
  validDate: 'Enter a valid date.',
  noPhone: "Enter the donor's phone number.",
  noAmount: 'Enter the amount received.',
  pickMethod: 'Pick a method from the list.',
  noGoal: 'Enter a goal.',
  // Prefixes only: the app builds the rest of these two from MAX_TEXT and WARNING_MARK.
  tooLong: 'Keep this under',
  nameMark: 'A name cannot start with',
  counted: 'Counted',
  duplicateHint: 'This phone number is already on the pledge for',
  oldNumber: 'payments were logged under the old number',
  oldNumberNext: 'They will stop counting for this donor. After saving, go to Payments, search the old number, and change each one to the new number.',
  notPledgedYet: "If this donor hasn't pledged yet, press Cancel and use Pledges → Add pledge → Save and log a payment.",
  isThisFrom: 'Is this from',
  useTheirNumber: 'Use their number',
  paidInFull: 'has paid in full',
  listedTwice: 'listed more than once',
  alreadyLogged: 'is already logged.',
  sameThenCancel: 'If this is the same payment, press Cancel.',
  discardTyping: 'Discard what you typed?',
  keepEditing: 'Keep editing',
  saveAndAddAnother: 'Save and add another',
  deletePledge: 'Delete this pledge? Any payments from this phone number stay on the Payments tab but will show',
  deletePledgeStopsCounting: 'and stop counting toward Total received.',
  deletePledgeKept: 'Delete this pledge? Their payments stay matched to the other pledge for',
  deletePledgeNoPayments: 'Delete this pledge? It has no payments.',
  listedMoreThanOnce: 'Listed more than once',
  future: '(future)',
  deletePayment: 'Delete this payment? It will be removed from every total.',
  healthIntro: 'Every figure below should read 0. Anything higher needs a look.',
  methodTotal: 'Total (should match Payments Logged)',
  figuresAsOf: 'Figures as of',
  lastChangedBy: 'Last changed by',
  lastChangedAt: 'Last changed at',
  refreshing: 'Refreshing…',
  couldNotDownload: "Couldn't download the file",
  noDonorFound: 'No donor found.',
  refreshBeforePledge: 'If they pledged with another volunteer since then, press Refresh before adding a pledge.',
  saveAnyway: 'If they pledged with another volunteer, save this payment anyway — it will match once your list refreshes. Do not add a second pledge.',
  keepTyping: 'keep typing to narrow it down.',
  displayStale: 'Figures may be out of date — tap to reconnect',
  saving: 'Saving…',
  saved: 'Saved.',
  signOutWhileSaving: 'A change is still saving. Signing out now could lose it. Sign out anyway?',
  signOutWithFailedSave: 'A change could not be saved. Signing out now loses it. Sign out anyway?',
  signedOut: 'You are signed out',
  signInAgain: 'Sign in again',
  signOutOfGoogle: 'Sign out of Google on this computer',
  couldNotSave: "Couldn't save",
  couldNotDelete: "Couldn't delete",
  trackerMenu: 'Fundraiser tracker',
  newDriveMenu: 'Start a new drive…',
  addRowsMenu: 'Add selected rows to the tracker…',
  sortBy: 'Sort by',
  oldestFirst: 'Oldest first',
  defaultOrder: 'Default order',
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
    fix: [
      'Open the pledge and add the donor’s phone number. If the donor won’t give a number, use a made-up one such as ',
      b('000-0001'),
      ' (then ',
      b('000-0002'),
      '…), use it on every payment too, and say so in Notes. See ',
      b('Record a donor who won’t give a phone number'),
      ' in How to….',
    ],
  },
  paymentIncomplete: {
    meaning: 'A payment has a phone number but no date, or no amount. A payment without an amount adds nothing to any total.',
    fix: ['Open the payment and fill in the missing date or amount. If it was entered by mistake, delete it.'],
  },
  futureDated: {
    meaning: 'A payment is dated after today. It is still counted, but it is usually a typo, such as the wrong year.',
    fix: ['Open the payment and correct the Date received. If it is a real post-dated check, see ', b('A donor gives post-dated checks'), ' in How to….'],
  },
  predatesPledge: {
    meaning: 'A donor’s most recent payment is dated before their Date Pledged. One of the dates is probably wrong.',
    fix: ['Check the Date Pledged on the pledge and the dates on the donor’s payments, and correct whichever is wrong. If the donor raised their pledge, set Date Pledged back to the date of their first promise.'],
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
    action: ['Wait for the connection to come back — a save waits up to 20 seconds for it by itself. If a save failed meanwhile, press ', b('Reopen'), ' on its message and ', b('Save'), ' again. You can still read the screens.'],
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
    meaning: [
      'The save did not reach the shared sheet, usually because the connection dropped or was too slow. The tracker had already tried again by itself. If your phone or computer seems to be online, the message goes on to say the Apps Script deployment may not allow access to “Anyone”. That only matters if it keeps happening. It is a setup problem that only the organiser can fix.',
    ],
    action: ['Check your connection, then press ', b('Reopen'), ' on the message. The form comes back with everything you typed; press ', b('Save'), ' again. If other websites work and it keeps happening, tell the organiser, and include the exact message.'],
  },
  {
    message: [said(`${SAID.httpError} (…). Try again.`)],
    meaning: ['Google’s servers had a hiccup.'],
    action: ['Press ', b('Reopen'), ' on the message, then ', b('Save'), ' again. If it keeps happening, tell the organiser.'],
  },
  {
    message: [said(SAID.busy)],
    meaning: ['Many volunteers saved at the same moment, and the tracker handles one save at a time. It had already tried again by itself before showing this.'],
    action: ['Wait a few seconds, press ', b('Reopen'), ' on the message, then ', b('Save'), ' again. Nothing was lost. If it keeps happening, tell the organiser.'],
  },
  {
    message: [said(SAID.serverError)],
    meaning: ['Something unexpected happened on the tracker’s side.'],
    action: ['Press ', b('Reopen'), ' on the message, then ', b('Save'), ' again. If it keeps happening, tell the organiser.'],
  },
  {
    message: [said(SAID.expired)],
    meaning: ['Your Google sign-in could not be confirmed, even after the tracker asked you to sign in again.'],
    action: [
      'Press ',
      b('Reopen'),
      ' on the message, then ',
      b('Save'),
      ', and sign in if the window appears. If it was a delete, open the row and press ',
      b('Delete'),
      ' again. If the tracker would not open, press ',
      b('Try again'),
      '. If it keeps happening, tell the organiser, and include the exact message.',
    ],
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
    meaning: ['You signed in with a Google account that is not on the organiser’s volunteer list: it was never added, or it has been taken off.'],
    action: [
      'Ask the organiser to add that email address, or press ',
      b(SAID.differentAccount),
      ' and sign in with the account they did add. If this replaced the tracker while you were using it, ask the organiser to add you back, then press ',
      b('Try again'),
      '. If it appears on a message about a save, ask the organiser to add you back. Do not press ',
      b('Dismiss'),
      ': once you are back on the list, press ',
      b('Reopen'),
      ' and ',
      b('Save'),
      '.',
    ],
  },
  {
    message: [b(SAID.couldNotLoad)],
    meaning: ['The tracker could not fetch the pledges and payments when it opened. The reason is shown underneath.'],
    action: ['Press ', b('Try again'), ', which reloads the page; you stay signed in. If the reason mentions the server or the deployment, tell the organiser.'],
  },
  {
    message: [said(SAID.conflict)],
    meaning: ['Another volunteer saved a change to the same pledge or payment after you opened it, or the organiser corrected it in the sheet.'],
    action: ['Press ', b('Reload'), ', open the row again, look at their change, and redo yours if it is still needed.'],
  },
  {
    message: [said(SAID.alreadySavedDifferent)],
    meaning: ['You pressed Save again on a new pledge or payment after a save that seemed to fail, and changed something first. The first save had actually gone through, with the values from before.'],
    action: ['Press ', b('Reload'), ' (the question has no Reopen button). Open the entry on the list and correct it if needed. Do not add it again.'],
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
        ['The tracker opens on the Summary the first time, and after that on whichever page you last had open on that device. If that takes more than a few seconds, you see ', said(SAID.stillLoading), ' Your email address shows at the top of the page on a computer.'],
      ),
      p('Only people on the organiser’s volunteer list can open the tracker. If you see ', b(SAID.notOnListTitle), ', see ', b('When something goes wrong'), '.'),
      p('If you reload the page, you stay signed in for up to an hour, but only in that same tab. In a new tab or window you sign in again.'),
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
      p('Press ', b('Sign out'), ' at the top of the page when you finish. The tracker then shows ', said(SAID.signedOut), ', with a ', b(SAID.signInAgain), ' button. On your own phone you can stay signed in.'),
      p('Sign out closes the tracker, but it does not sign you out of Google. On a shared or borrowed computer, the next person to open the tracker in that browser could get back in as you with one tap and see every donor’s details. So on a masjid computer, or any computer other people use:'),
      bullets(
        [
          b('Best'),
          ' — use a Guest or private window (Incognito in Chrome, InPrivate in Edge). To open one, press Ctrl+Shift+N, or ⌘+Shift+N on a Mac (in Firefox, P instead of N), then open the tracker in it. When you finish, press ',
          b('Sign out'),
          ' and close the window: closing it signs Google out too. If you opened more than one private window, close them all.',
        ],
        ['If you did not use one, press ', b(SAID.signOutOfGoogle), ' on the signed-out screen. Only do this on a shared computer: it also signs that browser out of Gmail and every other Google service.'],
      ),
      p('If something you just saved is still on its way to the shared sheet, the tracker first asks ', said(SAID.signOutWhileSaving), ' Press ', b('Cancel'), ', wait a few seconds, then press ', b('Sign out'), ' again. If the change could not be saved, its message appears once you press Cancel, so you can deal with it first.'),
      p('While a change that could not be saved still has its message showing, the tracker asks ', said(SAID.signOutWithFailedSave), ' Press ', b('Cancel'), ', then ', b('Reopen'), ' on the message and ', b('Save'), ' again, or ', b('Dismiss'), ' if you no longer need that change.'),
      note('On a computer, closing or reloading the page while a change is still saving, or while a change that could not be saved still has its message showing, asks first too. A phone usually does not ask, so on a phone wait a few seconds after your last change, until no row shows ', said(SAID.saving), ', before you close the page.'),
    ),
  ];
}

function theScreens(): Child[] {
  return [
    p('Move between screens with the tabs at the top: ', b('Summary'), ', ', b('Pledges'), ', ', b('Payments'), ', ', b('Find donor'), ' and ', b('Help'), '.'),
    topic(
      'Summary',
      bullets(
        [b('Updated'), ' — the line above the title gives the date and time the tracker last fetched the figures from the shared sheet. Press ', b('Refresh'), ' to see changes other volunteers made since then. A printed Summary shows this date and time too.'],
        [b('Goal'), ' — how much has been received against the fundraiser goal, with a progress bar. ', b('Edit goal'), ' changes the target.'],
        [b('The four totals'), ' — Total pledged, Total received, Balance outstanding, and Overpaid / credit. ', b('Understanding the numbers'), ' explains each one.'],
        [b('Donors'), ' — how many donors have pledged, and how many are Fully paid, Partial, Pending or Overpaid.'],
        [b('Reconciliation'), ' — Payments logged (every payment typed in) next to Unmatched payments (Payments logged minus Total received). Unmatched should be $0.00. When it is not, the card turns amber and says whether some money is not being counted or is being counted twice.'],
        [b('Data health'), ' — checks for common mistakes. ', said(SAID.healthIntro), ' ', b(HEALTH_LABELS.possibleDuplicatePayments), ' is a prompt to double-check rather than a certain problem. Tap ', b('Show'), ' next to a check to see just the rows it found. A note under the checks says when the shared sheet has rows that are not counted because they have no id; only the organiser can fix those.'],
        [b('Collected by payment method'), ' — a chart and table of money by Cash, Card and so on. Payments with no method appear as ', b('No method recorded'), '. The last row, ', said(SAID.methodTotal), ', should equal Payments logged.'],
        [b('Download .xlsx'), ' — fetches the latest figures, then saves the pledges, payments and totals as an Excel file: a readable record for the treasurer.'],
        [b('Friday display'), ' — a full-screen view of the fundraiser for the projector. See ', b('Show the fundraiser on the projector'), ' in How to….'],
      ),
    ),
    topic(
      'Pledges',
      p('One row per donor. You type the ', b('Phone Number'), ', ', b('Donor Name'), ', ', b('Date Pledged'), ', ', b('Amount Pledged'), ' and ', b('Notes'), '. The tracker works out the rest from the Payments screen: ', b('Last Payment'), ', ', b('Received'), ', ', b('Balance Due'), ', ', b('# Payments'), ' and ', b('Status'), '.'),
      bullets(
        ['The line above the table shows the running totals: pledged, received, outstanding and number of payments.'],
        ['A phone number followed by ', said(SAID.listedMoreThanOnce), ' is on more than one pledge, and those rows are shaded red. That donor’s payments are being counted twice until you fix it.'],
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
          ' finds Pending or Partial donors with no payment, and no change saved to their pledge, in the last 30 days, biggest balance first. See ',
          b('Follow up with donors who still owe'),
          ' in How to…. Press ',
          b('All'),
          ' to see every pledge again.',
        ],
      ),
    ),
    topic(
      'Payments',
      p('One row per payment. You type the ', b('Phone Number'), ', ', b('Date Received'), ', ', b('Amount'), ', ', b('Method'), ' and ', b('Notes'), '. The ', b('Donor Name'), ' is filled in for you by matching the phone number to a pledge.'),
      bullets(
        ['A ', b('⚠'), ' warning in Donor Name means the payment is not being counted, and the row is shaded red. ', b('Warnings and data health'), ' explains why and how to fix them.'],
        ['A date followed by ', said(SAID.future), ' is later than today, which is usually a typo. The date is also shaded amber.'],
        ['The coloured label in the Method column shows how the money was paid.'],
        [
          b('From'),
          ' and ',
          b('To'),
          ' filter to payments received in that range; either can stay blank. ',
          b('Today'),
          ' sets both to today’s date. ',
          b('This week'),
          ' sets From to the last Saturday (today, on a Saturday) and To to today. Payments with no date drop out once a bound is set. ',
          b('Clear dates'),
          ' removes the range.',
        ],
        [
          'While the list is narrowed, the line above it adds up the money in the rows shown, for example “Showing 4 of 27 · $300.30 logged”, and the line under that splits it by method, for example “Cash $250.30 · Card $50.00”. It counts every payment shown, even one with a ',
          b('⚠'),
          ' warning, because that money still came in.',
        ],
        ['To count tonight’s cash, tap ', b('Today'), ' and read the Cash figure. A payment typed with no date, or the wrong one, is left out of it, so if the cash box holds more than the figure, look for one.'],
      ),
    ),
    topic(
      'Find donor',
      p('Type a donor’s phone number, in any format, or part of their name. The whole number takes you straight to the donor. Part of a number, such as the last four digits, or part of a name shows a list of matching donors with their number and status. Several donors can share the same last few digits, so check the name as well before you tap one to open it.'),
      p('When lots of donors match, only the first 20 are listed, under a line such as ', said(`Showing 20 of 312 — ${SAID.keepTyping}`), ' Type a few more letters or digits and the list shrinks.'),
      p('If nobody matches, it says ', said(SAID.noDonorFound), ' and offers ', b('Add a pledge'), '. If you searched by phone number, that number is already filled in on the pledge form. If you only typed part of the number, type the rest before saving.'),
      p('If your list was last refreshed more than a couple of minutes ago, it also says how long ago, and adds ', said(SAID.refreshBeforePledge), ' Another volunteer may have just added that donor, and two pledges for the same donor count their payments twice.'),
      p('The donor card shows their pledge, what they have paid, their balance and status, and every payment they have made. If they have paid more than they pledged, the extra shows as ', b('Credit'), '. On a phone, tap their phone number to call them.'),
      p(
        'From the card, press ',
        b('Log a payment'),
        ' to record money from them, press ',
        b('Edit pledge'),
        ' to correct their pledge, or tap one of their payments to correct or delete it. If you change the phone number on their pledge, the card keeps showing them.',
      ),
      p(
        'If a donor asks what they have paid so far, press ',
        b('Print'),
        ' on their card. The printed page has the masjid’s name, today’s date, their pledge, each payment and the total paid. Notes and warnings are left off, because they are written for volunteers. On a phone, the print options usually let you save it as a PDF to send instead. It is a record of payments, not a tax receipt.',
      ),
    ),
    topic(
      'Search and sort',
      bullets(
        ['The search box on Pledges and Payments looks through phone numbers, names and notes (and the method, on Payments). Part of a phone number works too. Clear the box to see everything again.'],
        ['Lists start with the most recently added entry, so a pledge or payment you have just added is at the top. Tap a column heading to sort by it. An arrow beside the heading shows which way: ▲ is A to Z, smallest or oldest first, and ▼ is the reverse. Tap it again to reverse the order, and a third time to go back to the order the list started in.'],
        ['On a phone, use ', b(SAID.sortBy), ' above the list instead. Each choice says which way it sorts, and ', b(SAID.oldestFirst), ' goes by the date on each entry. ', b(SAID.defaultOrder), ' goes back to the order the list started in.'],
        ['The status chips on Pledges and the date range on Payments are explained under ', b('Pledges'), ' and ', b('Payments'), ' above.'],
        ['Search, the status chips (Pledges) and the date range (Payments) all narrow the list together. A “Showing N of M” line appears whenever any of them is doing something. On Payments it also adds up the money in those rows, and how much came by each method.'],
        ['A long list only shows the first 100 rows at a time (25 on a phone, so the list opens quickly), with a ', b('Show more (N left)'), ' button underneath to reveal the rest. Search, sort and the filters above always look through every row, not just the ones on screen — narrowing the list can bring a row onto the screen even if you have not pressed Show more.'],
        ['Tapping ', b('Show'), ' next to a Data-health check on Summary clears any search, status chips or date range first, so the flagged rows it found are never hidden behind a filter left over from before.'],
      ),
    ),
    topic(
      'On a phone',
      p('On a narrow screen each row becomes a small card, with the column name on the left of every value. Tap a card to open it. The column headings are hidden, so to sort, use ', b(SAID.sortBy), ' above the list.'),
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
      note('If the phone number is already on another pledge, an amber note appears: ', said(`${SAID.duplicateHint} …`), ' Do not save a second pledge for the same donor — edit the existing one instead. If it is someone else in the same household, either add their amount to that pledge and write each person’s share in Notes, or use their own phone number.'),
      note('If the donor is also handing over money right now, press ', b('Save and log a payment'), ' instead of Save. See ', b('Someone pledges and pays at once'), '.'),
      note('Typing up a stack of pledge cards? Press ', b(SAID.saveAndAddAnother), ' instead of Save. The pledge saves and an empty form opens for the next card with the same Date pledged, so check the date on each card. Nothing is saved from that empty form until you type in it, so after the last card, press Cancel.'),
      note('You can also start a pledge from ', b('Find donor'), ': when nobody matches your search, press ', b('Add a pledge'), '. A phone number you searched for is filled in for you.'),
    ),
    topic(
      'Log a payment',
      steps(
        ['Go to ', b('Payments'), ' and press ', b('Log a payment'), '.'],
        [
          'Type the donor’s phone number. Just under it, the tracker shows who it found and what they still owe, for example “Donor: Aisha Rahman · owes $400.00 of $500.00”. If it shows a ⚠ warning instead, the payment will not be counted — check the number before saving. For a number that is on no pledge, the warning also says: ',
          said(SAID.notPledgedYet),
        ],
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
      note('If the warning is ', said(WARN_NOT_IN_PLEDGES), ' and your list was last refreshed more than a couple of minutes ago, it adds ', said(SAID.saveAnyway), ' The payment finds the donor’s pledge by phone number as soon as your list refreshes.'),
      note(
        'If a number on no pledge is close to one that is — one digit different, two digits side by side swapped, or the same 10-digit number with a country code (other than the US +1, which already matches) or a leading 0 in front of only one of them — a question appears under the warning, for example ',
        said(`${SAID.isThisFrom} Aisha Rahman (555-010-0101)?`),
        ' Check the name with the donor or on the envelope first: two different donors can have numbers one digit apart. If it is them, press ',
        b(SAID.useTheirNumber),
        '. The tracker never changes the number by itself.',
      ),
      note(
        'What the donor still owes is there so you can check the amount with them. A donor who has paid it all shows ',
        said(SAID.paidInFull),
        ', and one who has paid extra shows how much more than the pledge. What they owe is not shown when you edit a payment, because that payment is already counted in it, or when the amount pledged is 0 (not known yet). If it says instead ',
        said(SAID.listedTwice),
        ', the donor is on more than one pledge and their payments are counted twice — see ',
        b('Fix a donor entered twice'),
        '.',
      ),
      note(
        'If a payment with the same phone number, amount and date is already logged, an amber note appears under the amount, for example ',
        said(`A $100.00 payment from this number dated Sep 24, 2026 ${SAID.alreadyLogged} ${SAID.sameThenCancel}`),
        ' Two real installments of the same amount on the same day can happen, so Save still works. When you edit a payment, it says to press Delete instead. It only knows the payments on this device — another volunteer’s appear after ',
        b('Refresh'),
        ' — so after a save that seemed to fail, still check the list first.',
      ),
      note('Log each installment as its own payment. Do not edit an old payment to add a new amount to it — the tracker adds up the installments for you.'),
      note('Logging several payments in a row? Press ', b(SAID.saveAndAddAnother), ' instead of Save. The payment saves and an empty form opens for the next one with the same date and payment method, so change them if the next payment differs. After the last one, press Cancel on the empty form.'),
      note('For a gift made online, type the amount the donor gave, as shown on their receipt — not the smaller amount the giving website sends the masjid after taking its fee, or the donor will show as still owing the fee. You can put the website’s reference number in Notes.'),
      note(
        'You can also log a payment straight from a donor: open their card on ',
        b('Find donor'),
        ', or tap their pledge on ',
        b('Pledges'),
        ', and press ',
        b('Log a payment'),
        ' there — the phone number is filled in for you, and the cursor starts in Amount received. If you had changed anything on the pledge, the tracker asks ',
        said(SAID.discardTyping),
        ' first, so you don’t lose typing you meant to keep.',
      ),
    ),
    topic(
      'Someone pledges and pays at once',
      p('When a donor makes a pledge and hands over money in the same visit — or gives money without ever having pledged — record both in one go, typing the phone number only once.'),
      steps(
        ['Go to ', b('Pledges'), ' and press ', b('Add pledge'), '. If you have just searched for them on ', b('Find donor'), ', press ', b('Add a pledge'), ' there instead.'],
        ['Fill in the pledge as usual, starting with the phone number.'],
        ['Press ', b('Save and log a payment'), '. The pledge saves, and the payment form opens with the phone number filled in and the donor’s name under it.'],
        ['The cursor is already in Amount received. Type the amount, pick the payment method, and press ', b('Save'), '.'],
      ),
      note('The ', b('Save and log a payment'), ' button appears once a phone number is typed. A payment finds its donor by phone number, so it needs one.'),
      note(
        'If the pledge could not be saved, a red message appears at the bottom of the screen. Once the payment form is saved or closed, press ',
        b('Reopen'),
        ' on the message and ',
        b('Save'),
        ' the pledge again. Until then the payment shows ',
        said(WARN_NOT_IN_PLEDGES),
        ' and is not counted.',
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
      'Record a donor who won’t give a phone number',
      p(
        'The phone number is how the tracker links a donor’s payments to their pledge, so without one no payment can be logged for them. If a donor won’t give theirs, give them a made-up number instead. For a one-off gift from someone who has not pledged, see ',
        b('Record money with no phone number (collection box, walk-in)'),
        ' in How to….',
      ),
      steps(
        ['Add their pledge, or open it if it is already on ', b('Pledges'), ', and type ', b('000-0001'), ' as the phone number. If an amber note says it is already on another pledge, try ', b('000-0002'), ', then ', b('000-0003'), ', and so on, until no note appears.'],
        ['In Notes, write that the number is made up, for example “No phone given — made-up number”.'],
        ['Use the same made-up number every time you log a payment from this donor.'],
      ),
      note('The made-up number shows wherever a phone number does, including Needs follow-up and the downloaded copy. The note tells anyone who sees it not to call it.'),
    ),
    topic(
      'Record money with no phone number (collection box, walk-in)',
      p('Some money has no donor to link it to: cash from the collection box, or a gift from someone who has not pledged and leaves no number. Log all of it under one shared pledge named General donations, so it still counts toward the goal.'),
      steps(
        ['The first time only: on ', b('Pledges'), ', press ', b('Add pledge'), '. Type ', b('000-000-0000'), ' as the phone number and ', b('General donations'), ' as the donor name, enter ', b('0'), ' in Amount pledged, and clear the Date pledged box so it is empty. Save. Do this only when you have a gift to log. Until it has one, it looks like a pledge nobody has paid, and 30 days after you save it, it shows under ', b('Needs follow-up'), '.'],
        ['Log the money as a payment with ', b('000-000-0000'), ' as the phone number. The line under it should show “Donor: General donations”. For the collection box, one payment for each count is enough; say where the money came from in Notes, for example “Collection box, Jumu’ah”.'],
        ['If you already logged such money under another number, open that payment and change its phone number to ', b('000-000-0000'), '.'],
      ),
      p('This money counts toward Total received, the goal and the Friday display, and Unmatched payments stays at $0.00. Two things look odd but are expected:'),
      bullets(
        ['General donations shows as ', b(STATUS.overpaid), ' and counts as one Overpaid donor, and all its money is added to ', b('Overpaid / credit'), ' on the Summary, because its pledge amount is 0. Leave it at 0: raising it would add to Total pledged and to the count of donors who pledged.'],
        ['Two gifts of the same amount on the same day, such as two $20 gifts on a Friday, appear under ', b(HEALTH_LABELS.possibleDuplicatePayments), ', and when you log the second one, an amber note on the form says one like it ', said(SAID.alreadyLogged), ' That is a false alarm: press Save anyway, and keep both.'],
      ),
      note('Date pledged stays empty so that no gift, however old, is flagged as coming before the pledge. Someone who has pledged, or will pay over time, needs their own made-up number instead: see ', b('Record a donor who won’t give a phone number'), ' in How to….'),
    ),
    topic(
      'Edit a pledge or payment',
      steps(['Find the row on Pledges or Payments (use the search box).'], ['Tap the row. The form opens with its current values.'], ['Change what you need and press ', b('Save'), '.']),
      note('You can also start from a donor’s card on ', b('Find donor'), ': press ', b('Edit pledge'), ', or tap one of their payments.'),
      note('When a donor raises their pledge, change the Amount pledged but keep the original Date pledged, and write the increase and its date in Notes. Changing Date pledged to today makes their earlier payments look as if they came before the pledge.'),
    ),
    topic(
      'Close a form without saving',
      p(
        'Press ',
        b('Cancel'),
        '. If you have typed or changed anything, the tracker first asks ',
        said(SAID.discardTyping),
        ' Press ',
        b(SAID.keepEditing),
        ' to go back to the form with your typing still there, or ',
        b('Discard'),
        ' to close it and lose what you typed.',
      ),
      note('Pressing Esc on a computer, or Back on an Android phone, usually asks the same question. Cancel always does.'),
    ),
    topic(
      'Follow up with donors who still owe',
      steps(
        ['On ', b('Pledges'), ', tap ', b('Needs follow-up'), '. The donors who owe the most are at the top.'],
        ['Tap a donor to open their pledge. Press ', b('Call'), ' or ', b('Text'), ', just under the phone number, to ring or message them from your phone.'],
        ['After calling, add a note such as “Called 24 Sep – paying Friday” and press ', b('Save'), '.'],
      ),
      p('The note shows on the donor’s row and their Find donor card, so other volunteers can see they were called once their list refreshes. Saving it also takes the donor off Needs follow-up for 30 days, so nobody calls them again straight away.'),
      note(
        'Any change saved to a pledge restarts its 30 days, even fixing a typo in the name. After many pledges are tidied up at once, those donors stay off Needs follow-up for a month, so check the ',
        b('Pending'),
        ' and ',
        b('Partial'),
        ' chips too.',
      ),
    ),
    topic(
      'Delete a pledge or payment',
      steps(
        ['Tap the row to open it.'],
        ['Press the red ', b('Delete'), ' button at the bottom of the form. On a pledge with a phone number it comes just after ', b('Log a payment'), '.'],
        ['Read the question and press ', b('Delete'), ' again to confirm. The row disappears at once.'],
      ),
      bullets(
        ['Deleting a payment asks: ', said(SAID.deletePayment)],
        ['Deleting a pledge asks: ', said(`${SAID.deletePledge} ${WARN_NOT_IN_PLEDGES} ${SAID.deletePledgeStopsCounting}`), ' It then says how many payments that is and how much money.'],
        ['If another pledge has the same phone number (a donor entered twice), it asks ', said(`${SAID.deletePledgeKept} …`), ' and names the donor on that pledge.'],
        ['If the pledge has no payments, it asks ', said(SAID.deletePledgeNoPayments)],
      ),
      note('There is no undo button. If you delete something by mistake, do not add it again: ask the organiser to bring the row back. The tracker keeps a copy of every deleted row for them.'),
    ),
    topic(
      'Fix a payment typed with the wrong phone number',
      p('The payment shows ', said(WARN_NOT_IN_PLEDGES), ' and a red row.'),
      steps(
        ['On ', b('Payments'), ', tap the red row.'],
        [
          'Correct the phone number. If the form asks ',
          said(`${SAID.isThisFrom} …?`),
          ' and names the right donor, press ',
          b(SAID.useTheirNumber),
          ' to fill in their number. Either way, the line under the phone box should now show “Donor:” and the right name.',
        ],
        ['Press ', b('Save'), '. The row turns normal and the money counts again.'],
      ),
      note('Not sure whose payment it is? Type the last 4 digits of the payment’s phone number into the search box on ', b('Pledges'), '. The donor shows up even when the rest of the number was typed differently.'),
      note('If it is the pledge’s number that was typed wrong, correct the pledge instead — see ', b('Correct a donor’s phone number'), '. Using the pledge’s number here would copy the mistake onto the payment.'),
      p(
        'If the phone number was right, press ',
        b('Refresh'),
        ' at the top of the page first: another volunteer may have just added the donor’s pledge. If the warning is still there, the donor has no pledge yet. Add a pledge for them with that number, and press ',
        b('Save'),
        ' — not Save and log a payment, because the payment is already there. It starts counting by itself. Next time, ',
        b('Someone pledges and pays at once'),
        ' records both together.',
      ),
    ),
    topic(
      'Correct a donor’s phone number',
      p('Payments find their donor by phone number. When you change the number on a pledge, payments logged under the old number keep it, so they stop counting for this donor until you change them too.'),
      steps(
        ['On ', b('Pledges'), ', tap the donor’s row, or press ', b('Edit pledge'), ' on their card in ', b('Find donor'), '.'],
        ['Type the new phone number. If payments were logged under the old one, an amber note under the box says how many, for example ', said(`3 ${SAID.oldNumber} 555-010-0110. ${SAID.oldNumberNext}`)],
        ['Press ', b('Save'), '.'],
        ['Go to ', b('Payments'), ' and search the old number. Tap each payment, change its phone number to the new one, and press ', b('Save'), '. The line under the phone box should show “Donor:” and the donor’s name.'],
      ),
      note('To check none were missed, open ', b('Summary'), '. Any payment still under the old number shows up in ', b(HEALTH_LABELS.notMatched), ' under Data health; tap ', b('Show'), ' next to it to see them.'),
    ),
    topic(
      'Handle a donor who paid more than they pledged',
      p('Their status shows ', b(STATUS.overpaid), ' and their Balance Due is shown in brackets, for example ($50.00). Their Find donor card shows it as ', b('Credit'), ' $50.00.'),
      steps(
        ['First check their payments for a typo, such as 500 typed instead of 50. Fix it if so.'],
        ['If the donor really did give more (for example, their employer matched the gift), you can raise their Amount pledged to match, or leave it. Either is fine — ask the organiser which they prefer.'],
      ),
      p('The extra money is shown under ', b('Overpaid / credit'), ' on the Summary. It never hides what other donors still owe.'),
      note('General donations is the exception: it always shows Overpaid, and its Amount pledged stays 0. See ', b('Record money with no phone number (collection box, walk-in)'), ' in How to….'),
    ),
    topic(
      'A check bounced or money was given back',
      p('The money has to come off the donor’s total. The tracker has no minus amounts, so you delete the payment — but write down what happened first.'),
      steps(
        ['On ', b('Pledges'), ', open the donor’s pledge and add a line to Notes, for example “Check #1042 for $500 dated 2026-09-10 bounced 2026-10-01”. Save.'],
        ['On ', b('Payments'), ', open that payment and delete it.'],
      ),
      p('If only part of the money was given back, do not delete the payment. Edit its amount down to what the masjid kept, and add the same kind of note to the pledge.'),
      note(
        'The donor’s balance goes back up, but saving the note takes them off ',
        b('Needs follow-up'),
        ' for 30 days, like any change saved to a pledge. So do not wait for them to show up there: call them now about what they still owe, or tell the organiser so someone does.',
      ),
      note('A deleted payment no longer shows on Payments or in the downloaded copy, so the note on the pledge is what tells volunteers what happened. The organiser can still find the deleted payment in the sheet’s ', b('Payments history'), ' tab.'),
    ),
    topic(
      'A donor gives post-dated checks',
      p('A post-dated check cannot be paid into the bank before its date. Log each one on the day it is deposited, not the day it is handed over, so the totals only count money the masjid can bank.'),
      steps(
        ['When the donor hands the checks over, open their pledge and add a line to Notes, for example “3 post-dated checks held: Nov, Dec, Jan”. Save. Anyone who sees them on ', b('Needs follow-up'), ' then knows not to call them for money already given.'],
        ['On the day each check is deposited, log it as a payment dated that day, and update the note.'],
      ),
      p('If one was already logged with its future date, its date on Payments is shaded amber and marked ', said(SAID.future), ', and it shows under ', b(HEALTH_LABELS.futureDated), ' in Data health. Delete it, add it to the note, and log it again on the day it is deposited.'),
      note('This is the suggested way. If the organiser prefers another, such as counting the checks as soon as they are handed over, follow theirs.'),
    ),
    topic(
      'Fix a donor entered twice',
      p('On Pledges, both rows show ', said(SAID.listedMoreThanOnce), ' after the phone number and are shaded red, and Data health shows ', said(HEALTH_LABELS.duplicates), '. Until you fix it, that donor’s payments are counted twice.'),
      steps(
        ['On ', b('Summary'), ', tap ', b('Show'), ' next to ', b(HEALTH_LABELS.duplicates), ' to see just those rows.'],
        ['Decide which row to keep. Open it and make it complete: the correct amount (add the two together if they really were two separate promises), the name, and any notes from the other row. Save.'],
        ['Open the other row and delete it.'],
      ),
      note('You do not need to move any payments. They match by phone number, so they stay with the pledge you kept, and the delete question says so.'),
    ),
    topic(
      'Change the fundraiser goal',
      steps(['On ', b('Summary'), ', press ', b('Edit goal'), ' in the Goal card.'], ['Type the new goal and press ', b('Save'), '.']),
    ),
    topic(
      'Show the fundraiser on the projector',
      steps(
        ['On the computer connected to the projector, open a Guest or private window: press Ctrl+Shift+N on most computers. See ', b('Signing out'), ' in Getting started for why.'],
        ['Open the tracker in that window and sign in.'],
        ['On ', b('Summary'), ', press ', b('Friday display'), '.'],
        ['Make the browser full screen (F11 on most computers).'],
        ['When the announcement is over, press F11 to leave full screen, then press ', b('Exit'), ', then ', b('Sign out'), ', then close the window.'],
      ),
      p('The screen shows the drive’s name (or just “Fundraiser” until the organiser sets one), the amount received, the goal, the percentage and how many donors have pledged. It never shows a donor’s name, phone number or amount.'),
      p(
        'When it opens, it fetches the latest figures, unless they were fetched in the last 3 minutes. After that it updates itself every few minutes and shows the time of the last update. To include an entry made in the last few minutes, press ',
        b('Refresh'),
        ' on the Summary just before you press ',
        b('Friday display'),
        '. It never asks anyone to sign in on its own, so a sign-in box will not pop up in the middle of an announcement.',
      ),
      p('If a sign-in box appears when you press ', b('Friday display'), ', sign in: your sign-in was about to run out, and signing in now keeps the screen updating for about another hour.'),
      note('Google sign-ins last about an hour. After that the figures stop updating, and after 15 minutes a small note says ', said(SAID.displayStale), '. Tap it and sign in to bring the figures up to date. Press ', b('Exit'), ' in the top corner to go back to the Summary.'),
      bullets(
        [b('Sign in first'), ' — sign in on the projector computer before the khutbah starts, not during it, so the screen has a fresh hour and nothing interrupts the display.'],
        [b('Check Unmatched payments first'), ' — on ', b('Summary'), ', make sure ', b('Unmatched payments'), ' reads $0.00 before you press ', b('Friday display'), '. If it does not, the amount on the screen is not right yet: some money is not being counted, or is being counted twice. See ', b('Payments logged and Unmatched payments'), ' in Understanding the numbers.'],
        [b('Keep the laptop awake'), ' — turn off sleep and screen-lock (or plug it in and disable auto-sleep) for the computer driving the projector, so the display does not go dark on its own.'],
      ),
    ),
    topic(
      'Find out how much came in this week',
      steps(['Go to ', b('Payments'), ' and tap ', b('This week'), '.'], ['Read the line above the list, for example “Showing 12 of 340 · $1,200.00 logged”. The line under it splits that by method.']),
      p('The week starts on Saturday, so on a Friday it covers the whole week since the last Jumu’ah. For any other stretch, such as one evening or a month for a board meeting, set ', b('From'), ' and ', b('To'), ' yourself.'),
      note('The figure counts every payment in those dates, even one with a ', b('⚠'), ' warning, which Total received leaves out. If you announce it next to Total received, fix those rows first. A payment typed with no date, or the wrong one, is left out, so if the figure seems low, look for one.'),
    ),
    topic(
      'Download a copy',
      steps(
        ['On ', b('Summary'), ', press ', b('Download .xlsx'), '.'],
        ['The tracker first fetches the latest figures from the shared sheet. ', b('Refresh'), ' at the top of the page reads ', said(SAID.refreshing), ' while it does.'],
        ['Your device saves a file named like ICG-Fundraiser-2026-09-24-1401.xlsx. It opens on the Summary sheet, followed by the Pledges and Payments sheets.'],
      ),
      p('So the file has everything saved up to the moment you pressed Download, other volunteers’ changes included. The first row of its Summary sheet, ', said(SAID.figuresAsOf), ', gives the date and time of that fetch — the same time shown at the top of the Summary screen, and in the file name (1401 means 2:01 PM). If a row still shows ', said(SAID.saving), ', wait for it to finish before you download, in case that save does not go through.'),
      p('Downloading needs a connection. If the tracker cannot reach the shared sheet, it says ', said(SAID.couldNotDownload), ' and saves nothing, so you never get an out-of-date copy by mistake. Try again once you are back online.'),
      p(
        'The Payments sheet lists every payment, including ones with a ⚠ warning. Its ',
        said(SAID.counted),
        ' column says No for those. So adding up its Amount Received column gives Payments logged, not Total received. To get Total received, add up the Amount Received column on the Pledges sheet instead (a donor listed more than once is counted once per row there, just as on the Summary). On the Pledges sheet, ',
        said(SAID.listedMoreThanOnce),
        ' says Yes on every row whose phone number is on more than one pledge.',
      ),
      p(
        'The Pledges and Payments sheets end with ',
        said(SAID.lastChangedBy),
        ' and ',
        said(SAID.lastChangedAt),
        ': who last saved each row, and when. That is the email of whoever last saved the row in the tracker, not always the person who took the money — fixing a typo in someone else’s payment puts your email there. A row the organiser corrected straight in the shared sheet shows the organiser’s email, or “edited in Sheet” when Google does not say who made the change. A row the organiser brought in from a list kept outside the tracker shows “imported” and the date and time, with Last changed at left empty.',
      ),
      p('On the Pledges and Payments sheets, the small arrow beside each heading lets you show only some rows, for example only Partial pledges or only Cash payments.'),
      p(
        'To save just part of a list, filter it on ',
        b('Pledges'),
        ' or ',
        b('Payments'),
        ' and press ',
        b('Download this list'),
        ', next to “Showing N of M”. It saves every matching row in the order shown, even those still behind Show more, with a second sheet saying what the list was filtered to and what it adds up to. It saves what your screen has, so press ',
        b('Refresh'),
        ' first to include other volunteers’ latest changes. A printed list names its filter too, and says how many rows it left out — press ',
        b('Show more'),
        ' until they are all on screen before you print.',
      ),
      note('The file holds every donor’s name, phone number and amounts. Keep it to yourself: do not forward it or post it in a group chat, and delete old copies you no longer need. Treat a list you download or print for calls the same way: delete the file, or shred the paper, once you are done with it.'),
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
      p('Amount Pledged minus Received, for one donor. A negative balance is a credit: the donor has given more than they pledged. The tracker shows negative money in brackets, so ($50.00) means a $50 credit. The Find donor card writes it out as Credit $50.00.'),
    ),
    topic(
      'The Summary totals',
      terms(
        [b('Total pledged'), 'Every Amount Pledged added together.'],
        [b('Total received'), 'Money matched to a pledge. Payments with a ⚠ warning are not included.'],
        [b('Balance outstanding'), 'Only the money donors still owe. A donor’s credit is never subtracted from another donor’s debt.'],
        [
          b('Overpaid / credit'),
          'All the extra money from donors who gave more than they pledged, shown separately. Money logged under General donations is counted here too; see ',
          b('Record money with no phone number (collection box, walk-in)'),
          ' in How to….',
        ],
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
      p('It is rounded down to a tenth of a percent, so it never shows 100% until the goal is met. The Friday display shows the amount received in whole dollars, rounded down too, so it can read a little less than the Summary.'),
    ),
    topic(
      'Phone numbers',
      p('The phone number is how a payment finds its donor. Dashes, spaces, brackets, dots and the + sign are ignored, so 555-010-0101, (555) 010 0101 and 5550100101 are the same donor.'),
      p('A US number with or without +1 is the same donor, so ', b('+1 555 010 0101'), ' and ', b('555 010 0101'), ' match. A leading 0 still matters: ', b('0551234'), ' and ', b('551234'), ' are different numbers.'),
      p('A number copied from a contact card or a message matches too: the invisible marks some phones and computers add when you copy a number are ignored. Arabic and Urdu digits count the same as 0–9, so ', b('٥٥٥٠١٠٠١٠١'), ' and ', b('5550100101'), ' are the same donor.'),
    ),
  ];
}

function warningsAndHealth(): Child[] {
  return [
    topic(
      'The two warnings',
      p('A payment that is not being counted shows a warning in its Donor Name, and its row turns red.'),
      terms(
        [
          said(WARN_NOT_IN_PLEDGES),
          'No pledge has this phone number. Usually the number was mistyped on the payment or the pledge. Open the payment: if the number is close to a donor’s, it asks ',
          said(`${SAID.isThisFrom} …?`),
          ' — check the name, then press ',
          b(SAID.useTheirNumber),
          '. Otherwise, type the last 4 digits of the number into the search box on ',
          b('Pledges'),
          ' to find the donor, and correct the number. If the number is right, press ',
          b('Refresh'),
          ' first; add a pledge only if the warning is still there. For money with no donor, such as collection-box cash, see ',
          b('Record money with no phone number (collection box, walk-in)'),
          ' in How to….',
        ],
        [said(WARN_NO_AMOUNT), 'The donor’s pledge has a blank Amount Pledged. Open the pledge and enter the amount, or 0 if it is not known yet.'],
      ),
    ),
    topic(
      'Marks and colours on the lists',
      terms(
        [said(SAID.listedMoreThanOnce), 'After a phone number on Pledges: that phone number is on more than one pledge, so the donor’s payments are counted twice. The row is shaded red.'],
        [b('⚠ in Donor Name'), 'On Payments: the payment is not counted. The row is shaded red.'],
        [said(SAID.future), 'After a date on Payments: the payment is dated in the future. The date is shaded amber.'],
      ),
    ),
    topic(
      'The data-health checks',
      p('All except ', b(HEALTH_LABELS.possibleDuplicatePayments), ' should read 0. That one can be a false alarm, as its entry below explains. When a check reads more than 0, tap ', b('Show'), ' to see the rows, then fix them as described below.'),
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
      ['You see other volunteers’ changes when you press ', b('Refresh'), ' at the top of the page. The tracker also refreshes by itself when you come back to it after 2 minutes or more since its last refresh, as long as no form is open, and each time you press ', b('Download .xlsx'), '.'],
      ['Until you refresh, the tracker does not know about a pledge another volunteer has just added. Before adding a pledge for a donor it cannot find, press ', b('Refresh'), ': two pledges for the same donor count their payments twice.'],
      ['The form closes as soon as you press Save, and the row shows ', said(SAID.saving), ' for a few seconds while it reaches the shared sheet — longer on a slow connection. You can carry on with the next entry meanwhile. If Google’s servers hiccup, the sheet is busy with other volunteers’ saves, or the connection drops for a moment, the tracker quietly tries again on its own — you do not need to do anything unless you actually see an error message.'],
    ),
    topic(
      'When two people change the same row',
      p('The tracker never silently overwrites someone else’s edit. If another volunteer saved a change to a row after you opened it, or the organiser corrected it in the sheet, your save stops and you see the message below, starting with what you were saving. If you are already typing in another form, it waits until you close that form:'),
      p(said(SAID.conflict)),
      steps(['Press ', b('Reload'), '.'], ['Open the row again and look at what changed.'], ['Make your change again if it is still needed.']),
      p(
        'If you reopen a save that seemed to fail and press Save again, the tracker checks whether the first one actually went through. If it did and you changed nothing, nothing is added twice. If you changed something, it asks you to reload instead, starting with what you were saving. For a change to an existing row you see the message above. For a new pledge or payment you see ',
        said(SAID.alreadySavedDifferent),
        ' Either way, press ',
        b('Reload'),
        ', find the entry on the list (the first save went through), open it and correct it if needed. Do not add it again. What you typed the second time is not kept.',
      ),
    ),
  ];
}

function whenSomethingGoesWrong(): Child[] {
  return [
    p('Most problems are a dropped connection. When a save fails, a red message appears at the bottom of the screen, starting ', said(`${SAID.couldNotSave} …`), ' and saying what was being saved — the donor’s name (or phone number) for a pledge, “the payment from” and the phone number for a payment, or “the goal” — followed by one of the messages below. The row goes back to how it was. If you are already typing in another form, the message appears as soon as you close that form.'),
    p('Press ', b('Reopen'), ' on that message: the form comes back with everything you typed, and you can press ', b('Save'), ' again; saving it this way never adds the row twice. The message does not go away on its own: it holds the only copy of what you typed, so it stays until you press Reopen or ', b('Dismiss'), '. Dismiss throws that copy away — press it only if you no longer need the entry. If the message has gone (for example, because the page was closed or reloaded), check the list first — do not add the row again from scratch without looking, or it may end up there twice.'),
    p('A delete that fails shows ', said(`${SAID.couldNotDelete} …`), ' and the row comes back. Open it and delete it again.'),
    problemTable(),
    topic(
      'Messages inside a form',
      p('These appear in red under a box when something in it needs fixing. Correct the box and press Save again.'),
      bullets(
        [said(SAID.notANumber)],
        [said(SAID.negative)],
        [said(SAID.decimals)],
        [said(SAID.tooLarge)],
        [said(SAID.validDate), ' On a computer, type the year in full (2026, not 26).'],
        [said(SAID.noPhone)],
        [said(SAID.noAmount)],
        [said(SAID.pickMethod)],
        [said(`${SAID.nameMark} ${WARNING_MARK}.`), ' A donor name cannot begin with the warning sign the tracker uses for payments it does not count.'],
        [
          said(`${SAID.tooLong} ${MAX_TEXT} characters.`),
          ' That box has too much text, usually Notes after many added lines. Shorten older lines, for example to one short line per call, and press Save again.',
        ],
        [said(SAID.noGoal), ' The goal box on ', b('Edit goal'), ' was left empty. Type the goal, or 0.'],
      ),
    ),
  ];
}

function forTheOrganiser(): Child[] {
  return [
    p('These tasks happen in the Google Sheet behind the tracker, not in the app.'),
    topic(
      'Volunteers',
      p(
        'Add each volunteer’s Google email address to the ',
        b('Allowlist'),
        ' tab, one per row, in the first column, from row 2 down. Row 1 is the heading (email) and is never read, so do not paste a list over it. To remove someone, delete their row. The tracker then turns them away the next time their page refreshes or saves (',
        b('Download .xlsx'),
        ' refreshes first, so it counts), and a refresh clears the page to ',
        b(SAID.notOnListTitle),
        '. Until then, a page they already have open keeps showing what it last loaded, and ',
        b('Download this list'),
        ' can still save it. Nothing can take back a copy they downloaded before. If you remove someone by mistake, add their row back and ask them to press ',
        b('Try again'),
        '.',
      ),
      p('To remember whose address is whose, you can type each volunteer’s name in the second column, next to their email. The tracker reads only the first column.'),
      p('If a volunteer’s phone is lost, remove them from the Allowlist and also sign their Google account out of that phone: in their Google Account, go to ', b('Security → Your devices'), ', choose the phone and sign out.'),
    ),
    topic(
      'Payment methods, the goal and the drive’s name',
      p('The ', b('Settings'), ' tab has one setting per row, below its heading row, which is never read. ', b('paymentMethods'), ' is the list volunteers pick from, separated by commas — for example Cash,Bank Transfer,Card,Check,Online,Other. ', b('goal'), ' is the fundraiser target; volunteers can also change it with ', b('Edit goal'), ' on the Summary.'),
      p(
        b('campaignName'),
        ' is the title of the Friday display, such as Masjid Expansion 2026. Left blank, the display says Fundraiser. If the tab has no campaignName row, add one: campaignName in the first column and the name in the second.',
      ),
      p('Volunteers see changes to Settings after pressing Refresh. Payments that use a method you removed are grouped as “Other / unlisted” on the Summary, and must be given a listed method the next time someone edits them.'),
      p('Volunteers log each online gift at the amount the donor gave, because logging what the giving website pays out would leave every online donor owing its fee. So the Online row under ', b('Collected by payment method'), ' on the Summary will be higher than what the website pays into the bank, by the amount of its fees.'),
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
          'To bring those rows in, select them and choose ',
          b(`${SAID.trackerMenu} → ${SAID.addRowsMenu}`),
          ' from the menu bar. It checks every row first and gives each one an id only if all of them pass. See ',
          b('Bring in a list kept outside the tracker'),
          ', below.',
        ],
        [
          'You can also type an id by hand, for a row or two: a word and a number no other row uses, such as dinner1, in the id column. For a batch, drag the small square at the corner of that cell down to fill in dinner2, dinner3 and so on, and use a different word for each batch. Nothing checks the row then, and the tracker counts it as changed today.',
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
          'When you type a phone number into the sheet, start it with an apostrophe (',
          b("'0551234"),
          ', ',
          b("'+1 336 555 0123"),
          '), as the tracker does. The apostrophe does not show in the cell. Without it, the sheet drops a leading 0, or treats a leading + as the start of a formula (often showing #ERROR!), and that row stops matching the donor’s other rows. Type dates as 2026-09-24 and amounts as plain numbers such as 50 or 1250.50. A date the sheet does not recognise as a date (for example 24/09/2026), or an amount with words in it, shows as blank in the tracker. This goes for corrections and for rows you bring in with a new id.',
        ],
        [
          'Add your own columns to Pledges or Payments only to the right of the last one, ',
          b('updatedBy'),
          '. Do not rename, move or delete the existing columns, and do not rename or delete the tabs. Otherwise the tracker stops loading and saving until the change is put back. Straight after the change, ',
          b('Edit → Undo'),
          ' takes it back. Later, put it back by hand: drag a moved column back to its place, delete a new column or drag it to the right of ',
          b('updatedBy'),
          ', and rename a tab back to its old name.',
        ],
        [
          'A deleted column or tab has to be copied back from an older version. Open ',
          b('File → Version history → See version history'),
          ' and click the newest version that still has it. Select the column (click its letter) or the whole tab (click the box above row 1, left of column A) and copy it. Back in the current sheet, insert an empty column in its place, or add a tab with exactly the old name, and paste it in. An entry saved in the few minutes before the mistake may be missing from that version, so ask the volunteers who were saving then to check theirs after pressing ',
          b('Refresh'),
          '.',
        ],
        [
          'Never press ',
          b('Restore this version'),
          ' to fix a column or tab. Volunteers’ saves go into the sheet’s versions alongside your own changes, so a version from before the mistake can also be from before some of their entries, and restoring it loses them.',
        ],
      ),
    ),
    topic(
      'Bring in a list kept outside the tracker',
      p(
        'If pledges and payments were written down in another spreadsheet before the tracker was in use, you can bring them all in at once from the sheet instead of typing each one. For a short list, typing it into the tracker with ',
        b(SAID.saveAndAddAnother),
        ' is simpler, and checks each entry as you go.',
      ),
      steps(
        [
          b('Try it on a copy first.'),
          ' In the sheet, choose ',
          b('File → Make a copy'),
          '. The copy has the same menu. Do the steps below on the copy with a few rows, look at what it wrote, then delete the copy (it holds donors’ phone numbers). The tracker keeps using the real sheet, so volunteers see nothing of the trial.',
        ],
        [
          b('Tidy the list.'),
          ' Keep one pledge row per donor, and one payment row per payment. Dates must be real dates, or typed like 2026-09-24. Amounts must be plain numbers such as 1250.50, with no $ or words. Payment methods must be spelled as on the Settings tab, or left empty. A phone number that starts with 0 or + must still have it. Look each donor up in ',
          b('Find donor'),
          ': if they are already in the tracker, bring in only their payments.',
        ],
        [
          b('Pledges first.'),
          ' Put the list’s columns in this order: phone, name, date pledged, amount pledged, notes. Copy the rows. On the Pledges tab, click column B a few rows below the last row, and choose ',
          b('Edit → Paste special → Values only'),
          '. Leave column A (id) empty. Rows pasted into it by mistake count in the tracker straight away, so delete them at once and paste again from column B.',
        ],
        [
          'Select the pasted rows (click the first row’s number at the left, then hold Shift and click the last one’s), then choose ',
          b(`${SAID.trackerMenu} → ${SAID.addRowsMenu}`),
          '.',
        ],
        [
          'If it lists problems, nothing was changed. Fix each cell it names, then select the rows and run it again. When every row is fine, it says how many it will add and lists anything worth checking first. Press OK.',
        ],
        [
          b('Then payments,'),
          ' the same way on the Payments tab, with the columns in this order: phone, date received, amount received, method, notes.',
        ],
        [
          'Press ',
          b('Refresh'),
          ' in the tracker. On the Summary, the totals should have gone up by what you added, and every Data health figure should still read 0, or you know why.',
        ],
      ),
      p(
        'To undo, before anyone edits them: the last message names the rows it added. Select those rows by their numbers, right-click and choose Delete rows, then ask volunteers to press Refresh. Each added row says “imported” and the time in its ',
        b('updatedBy'),
        ' column.',
      ),
      note('Rows brought in this way are not counted as changed today, so an old unpaid pledge shows under Needs follow-up straight away. docs/SETUP.md in the project’s GitHub repository has the full checklist.'),
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
          ', naming the copy with the date, such as ICG backup 2026-09-24. The copy stays in their own Google Drive and keeps every tab (Settings and the Allowlist too) and the tracker’s script, so the tracker can be set up again from it if the Sheet is ever lost. docs/SETUP.md in the project’s GitHub repository explains how.',
        ],
        [
          b('Download .xlsx'),
          ' on the Summary is a readable record for the treasurer, not the backup. The tracker cannot be set up again from it. Keep any downloaded copy on your own computer or in a private folder only you and the second editor can open — not a shared drive, email or group chat. It holds every donor’s name, phone number and amounts.',
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
          ' — and note the date. When it comes, delete everything that holds them: the tabs named for the finished drive (see below), every copy of the sheet (ask the second editor to delete their monthly copies, since only they can), and every downloaded .xlsx file. Deleting a tab does not take it out of the sheet’s ',
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
