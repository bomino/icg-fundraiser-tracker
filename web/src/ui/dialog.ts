import { h, type Child } from './dom';
import { findFocusSpot, focusableHeading, focusSpotOf, type FocusSpot } from './focus';

export interface DialogHandle {
  element: HTMLDialogElement;
  close(): void;
}

let dialogCount = 0;

interface Opener {
  element: HTMLElement;
  spot: FocusSpot;
}

// Only a control in the page's main area is followed. One anywhere else (a toast's Reopen, the form
// under a delete question) is either still there for the browser to return to, or has no replacement.
function openerInMain(): Opener | null {
  const main = document.getElementById('main');
  const active = document.activeElement;
  const spot = active && main?.contains(active) ? focusSpotOf(active) : null;
  return active instanceof HTMLElement && spot ? { element: active, spot } : null;
}

const openers = new WeakMap<HTMLDialogElement, Opener>();

// A form opened by the form closing under it (Save and add another, Save and log a payment) opens while
// focus is still in that form, so it carries on that form's opener: the closing form's close event finds
// it open and leaves focus alone, and once the last form of the run closes the page control is found again.
// A closed dialog stays in the page only until its close event, a task later, removes it.
function openerOfClosingDialog(): Opener | null {
  const closing = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog:not([open])')).reverse();
  return closing.map((dialog) => openers.get(dialog)).find((opener) => opener !== undefined) ?? null;
}

// Save and Delete redraw the page before their dialog closes, replacing the control that opened it, so
// the browser has nothing to hand focus back to and drops it on <body>, the top of the page.
function refocusOpener(opener: Opener) {
  const main = document.getElementById('main');
  const focusLost = document.activeElement === null || document.activeElement === document.body;
  // Focus the page already moved on purpose (a new screen's heading), or another dialog still open, wins.
  if (!main || !focusLost || document.querySelector('dialog[open]')) return;
  // Still there, yet not given focus back: the browser returned it to a form of the run already removed.
  const replacement = opener.element.isConnected ? opener.element : findFocusSpot(opener.spot, main);
  if (replacement) replacement.focus();
  // The row itself was deleted; its table is the nearest place to carry on from, or, once the list is
  // empty, its heading.
  else (findFocusSpot({ place: 'table' }, main) ?? focusableHeading(main))?.focus({ preventScroll: true });
}

export function openDialog(title: string, body: Node, footer: Child[]): DialogHandle {
  const titleId = `dialog-title-${++dialogCount}`;
  const dialog = h('dialog', { class: 'modal', 'aria-labelledby': titleId }, h('h2', { class: 'modal-title', id: titleId }, title), body, h('div', { class: 'modal-actions' }, ...footer));
  const opener = openerInMain() ?? openerOfClosingDialog();
  if (opener) openers.set(dialog, opener);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener) refocusOpener(opener);
  });
  document.body.append(dialog);
  dialog.showModal();
  return { element: dialog, close: () => dialog.close() };
}

export function confirmDialog(message: string, confirmLabel: string, variant: 'danger' | 'primary' = 'danger', cancelLabel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, cancelLabel);
    const confirm = h('button', { type: 'button', class: `btn btn-${variant}` }, confirmLabel);
    const handle = openDialog('Please confirm', h('p', { class: 'body-md' }, message), [h('span', { class: 'spacer' }), cancel, confirm]);
    cancel.addEventListener('click', () => handle.close());
    confirm.addEventListener('click', () => {
      confirmed = true;
      handle.close();
    });
    handle.element.addEventListener('close', () => resolve(confirmed));
  });
}

const dialogOpen = () => document.querySelector('dialog[open]') !== null;

// Resolves once `blocked` is false, re-checking whenever a dialog opens or closes or the display mode toggles.
function until(blocked: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (!blocked()) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (blocked()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'data-display'] });
  });
}

async function untilSettled(blocked: () => boolean): Promise<void> {
  for (;;) {
    await until(blocked);
    // A dialog's open attribute drops before its close event, whose handler may open the next form
    // (Log a payment does); wait out that task before trusting the page is clear.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!blocked()) return;
  }
}

/**
 * Resolves once no modal is open. An open form makes the rest of the page inert, so a toast added
 * then is never announced, and one that times out then is never seen.
 */
export function whenNoDialogOpen(): Promise<void> {
  return untilSettled(dialogOpen);
}

/**
 * Resolves once it is safe to open an unrequested question: no modal open (so it never lands on the
 * form a volunteer is typing in) and not in the Friday display (so no donor name reaches the projector).
 */
export function whenSafeToAsk(): Promise<void> {
  return untilSettled(() => dialogOpen() || document.body.dataset.display !== undefined);
}
