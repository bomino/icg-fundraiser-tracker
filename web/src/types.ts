export interface Pledge {
  id: string;
  phone: string;
  name: string;
  datePledged: string;
  amountPledged: number | null;
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Payment {
  id: string;
  phone: string;
  dateReceived: string;
  amountReceived: number | null;
  method: string;
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Settings {
  goal: number | null;
  paymentMethods: string[];
  /** The Friday display's title. Absent from a Code.gs deployed before it read one. */
  campaignName?: string;
}

/** Rows in each tab that the server skipped for having no id, though they look like entries. */
export interface RowsWithoutId {
  pledges: number;
  payments: number;
}

export type PledgeDraft = Pick<Pledge, 'phone' | 'name' | 'datePledged' | 'amountPledged' | 'notes'>;
export type PaymentDraft = Pick<Payment, 'phone' | 'dateReceived' | 'amountReceived' | 'method' | 'notes'>;
