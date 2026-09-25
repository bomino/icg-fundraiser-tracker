import { h, type Child } from './dom';

export interface DialogHandle {
  element: HTMLDialogElement;
  close(): void;
}

let dialogCount = 0;

export function openDialog(title: string, body: Node, footer: Child[]): DialogHandle {
  const titleId = `dialog-title-${++dialogCount}`;
  const dialog = h('dialog', { class: 'modal', 'aria-labelledby': titleId }, h('h2', { class: 'modal-title', id: titleId }, title), body, h('div', { class: 'modal-actions' }, ...footer));
  dialog.addEventListener('close', () => dialog.remove());
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

/** Resolves once no modal is open, e.g. so a toast does not time out while a form makes it unreachable. */
export function whenNoDialogOpen(): Promise<void> {
  return until(dialogOpen);
}

/**
 * Resolves once it is safe to open an unrequested question: no modal open (so it never lands on the
 * form a volunteer is typing in) and not in the Friday display (so no donor name reaches the projector).
 */
export async function whenSafeToAsk(): Promise<void> {
  const blocked = () => dialogOpen() || document.body.dataset.display !== undefined;
  for (;;) {
    await until(blocked);
    // A dialog's open attribute drops before its close event, whose handler may open the next form
    // (Log a payment does); wait out that task before trusting the page is clear.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!blocked()) return;
  }
}
