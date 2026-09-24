import { ApiError } from '../api';
import { confirmDialog } from './dialog';
import { showToast } from './toast';

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

// Code.gs sends this exact text for the ordinary update conflict (a row edited out from under you);
// the guide quotes the longer form below. A CONFLICT with any other message — e.g. a duplicate create
// saved with different values — is shown as the server phrased it, so its wording isn't lost.
const STALE_EDIT_MESSAGE = 'Someone else changed this row since you opened it.';

export function createErrorReporter(reload: () => Promise<void>): (err: unknown) => Promise<void> {
  return async (err) => {
    if (err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
      const message =
        err.code === 'NOT_FOUND'
          ? 'Someone else deleted this row. Reload to see the latest list.'
          : err.message === STALE_EDIT_MESSAGE
            ? 'Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.'
            : err.message;
      if (await confirmDialog(message, 'Reload', 'primary')) {
        await reload().catch((reloadError: unknown) => showToast(messageOf(reloadError), 'error'));
      }
      return;
    }
    showToast(messageOf(err), 'error');
  };
}
