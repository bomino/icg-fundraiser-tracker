import type { Payment, Pledge, Settings } from '../../web/src/types';

let sequence = 0;
const nextId = (prefix: string) => `${prefix}${++sequence}`;

export function pledge(fields: Partial<Pledge> = {}): Pledge {
  return {
    id: nextId('pledge-'),
    phone: '',
    name: '',
    datePledged: '',
    amountPledged: null,
    notes: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'owner@example.com',
    ...fields,
  };
}

export function payment(fields: Partial<Payment> = {}): Payment {
  return {
    id: nextId('payment-'),
    phone: '',
    dateReceived: '',
    amountReceived: null,
    method: '',
    notes: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'owner@example.com',
    ...fields,
  };
}

export const METHODS = ['Cash', 'Bank Transfer', 'Card', 'Check', 'Online', 'Other'];
export const SETTINGS: Settings = { goal: 10000, paymentMethods: METHODS };
export const TODAY = '2026-09-23';
