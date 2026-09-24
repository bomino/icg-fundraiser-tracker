import { ApiError } from '../api';
import { confirmDialog, whenNoDialogOpen } from './dialog';
import { showToast } from './toast';

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

// Code.gs sends this exact text for the ordinary update conflict (a row edited out from under you);
// the guide quotes the longer form below. A CONFLICT with any other message — e.g. a duplicate create
// saved with different values — is shown as the server phrased it, so its wording isn't lost.
const STALE_EDIT_MESSAGE = 'Someone else changed this row since you opened it.';

/** Reports an error; `context` names the change it interrupted (e.g. "Couldn't save Aisha"), since a background save's form has already closed. */
export type ErrorReporter = (err: unknown, context?: string) => Promise<void>;

export function createErrorReporter(reload: () => Promise<void>): ErrorReporter {
  // One reload question at a time, and never over a form: saves finish in the background, so the
  // volunteer may already be typing the next entry, and a Reload there would redraw under it.
  let queue: Promise<void> = Promise.resolve();

  async function askToReload(err: ApiError, context: string | undefined) {
    await whenNoDialogOpen();
    const message =
      err.code === 'NOT_FOUND'
        ? 'Someone else deleted this row. Reload to see the latest list.'
        : err.message === STALE_EDIT_MESSAGE
          ? 'Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.'
          : err.message;
    if (await confirmDialog(context ? `${context}. ${message}` : message, 'Reload', 'primary')) {
      await reload().catch((reloadError: unknown) => showToast(messageOf(reloadError), 'error'));
    }
  }

  return async (err, context) => {
    if (err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
      queue = queue.then(() => askToReload(err, context));
      return queue;
    }
    showToast(context ? `${context}. ${messageOf(err)}` : messageOf(err), 'error');
  };
}
