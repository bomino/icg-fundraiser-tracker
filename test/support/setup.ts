import { afterEach, vi } from 'vitest';

if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof proto.close !== 'function') {
    // Browsers drop the open attribute at once but fire 'close' as a later task, and the app is
    // written around that gap (whenSafeToAsk's extra task, auth.ts's `closing` bookkeeping, Log a
    // payment's handoff), so tests get the same order. Under vi.useFakeTimers the event waits until
    // the timers are advanced.
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      setTimeout(() => this.dispatchEvent(new Event('close')), 0);
    };
  }

  // A close event still queued when a test ends would fire during the next test, and its handler can
  // open a dialog there (Log a payment does). Let it land, then clear whatever it added. The wait is
  // skipped under fake timers a failed test never restored, where it would stall the hook instead.
  afterEach(async () => {
    if (!vi.isFakeTimers()) await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.replaceChildren();
  });
}

// jsdom has no scrollIntoView at all; form.ts calls it whenever an inline error is shown. A test
// that needs to assert on it wraps this no-op with vi.spyOn and restores the spy afterwards.
// Guarded like HTMLDialogElement above: plain-Node test files load this same setup file too.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    // no-op: jsdom has no layout, so there is nothing to scroll to.
  };
}
