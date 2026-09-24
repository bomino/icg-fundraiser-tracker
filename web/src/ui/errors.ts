import { ApiError } from '../api';
import { confirmDialog } from './dialog';
import { showToast } from './toast';

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

export function createErrorReporter(reload: () => Promise<void>): (err: unknown) => Promise<void> {
  return async (err) => {
    if (err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
      const message =
        err.code === 'CONFLICT'
          ? 'Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.'
          : 'Someone else deleted this row. Reload to see the latest list.';
      if (await confirmDialog(message, 'Reload', 'primary')) {
        await reload().catch((reloadError: unknown) => showToast(messageOf(reloadError), 'error'));
      }
      return;
    }
    showToast(messageOf(err), 'error');
  };
}
