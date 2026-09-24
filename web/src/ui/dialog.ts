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

export function confirmDialog(message: string, confirmLabel: string, variant: 'danger' | 'primary' = 'danger'): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
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

/** Resolves once no modal is open, e.g. so a background message never lands on top of the form a volunteer is typing in. */
export function whenNoDialogOpen(): Promise<void> {
  return new Promise((resolve) => {
    if (!document.querySelector('dialog[open]')) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector('dialog[open]')) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  });
}
