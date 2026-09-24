if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

// jsdom has no scrollIntoView at all; form.ts calls it whenever an inline error is shown. A test
// that needs to assert on it wraps this no-op with vi.spyOn and restores the spy afterwards.
// Guarded like HTMLDialogElement above: plain-Node test files load this same setup file too.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    // no-op: jsdom has no layout, so there is nothing to scroll to.
  };
}
