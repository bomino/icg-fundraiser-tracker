import { describe, expect, it } from 'vitest';
import { needsFollowUp } from '../../web/src/engine/followUp';
import { payment, pledge } from '../support/factories';
import { derivePledges } from '../../web/src/engine/derive';

const TODAY = '2026-09-24';

function derive(pledgeFields: Parameters<typeof pledge>[0], payments: Parameters<typeof payment>[0][] = []) {
  const [d] = derivePledges([pledge(pledgeFields)], payments.map((p) => payment(p)));
  return d;
}

describe('needsFollowUp', () => {
  it('is false for a Paid pledge no matter how stale', () => {
    const d = derive({ phone: '1', amountPledged: 100, datePledged: '2020-01-01' }, [{ phone: '1', amountReceived: 100, dateReceived: '2020-01-02' }]);
    expect(needsFollowUp(d, TODAY)).toBe(false);
  });

  it('is false for an Overpaid pledge no matter how stale', () => {
    const d = derive({ phone: '1', amountPledged: 100, datePledged: '2020-01-01' }, [{ phone: '1', amountReceived: 150, dateReceived: '2020-01-02' }]);
    expect(needsFollowUp(d, TODAY)).toBe(false);
  });

  it('is true when Pending with both dates blank', () => {
    const d = derive({ phone: '1', amountPledged: 100 });
    expect(needsFollowUp(d, TODAY)).toBe(true);
  });

  it('is false at exactly 30 days before today (not "more than")', () => {
    // 2026-08-25 is exactly 30 days before 2026-09-24.
    const d = derive({ phone: '1', amountPledged: 100, datePledged: '2026-08-25' });
    expect(needsFollowUp(d, TODAY)).toBe(false);
  });

  it('is true at 31 days before today', () => {
    const d = derive({ phone: '1', amountPledged: 100, datePledged: '2026-08-24' });
    expect(needsFollowUp(d, TODAY)).toBe(true);
  });

  it('uses the later of lastPaymentDate and datePledged, not datePledged alone', () => {
    // datePledged is stale, but a recent partial payment means no follow-up is needed yet.
    const d = derive({ phone: '1', amountPledged: 100, datePledged: '2020-01-01' }, [{ phone: '1', amountReceived: 40, dateReceived: '2026-09-01' }]);
    expect(d.status).toBe('Partial');
    expect(needsFollowUp(d, TODAY)).toBe(false);
  });

  it('is true for Partial when the latest activity is more than 30 days old', () => {
    const d = derive({ phone: '1', amountPledged: 100, datePledged: '2026-01-01' }, [{ phone: '1', amountReceived: 40, dateReceived: '2026-01-02' }]);
    expect(d.status).toBe('Partial');
    expect(needsFollowUp(d, TODAY)).toBe(true);
  });

  it('is false when a pledge has no Amount Pledged (status null)', () => {
    const d = derive({ phone: '1' });
    expect(d.status).toBeNull();
    expect(needsFollowUp(d, TODAY)).toBe(false);
  });
});
