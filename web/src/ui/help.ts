export const PLEDGE_HELP = {
  phone: "The donor's phone number — it is their ID. Dashes, spaces, brackets, dots and plus signs don't matter. One pledge per donor.",
  name: 'Full name, e.g. Ahmed Yusuf.',
  datePledged: 'The date the pledge was made.',
  amountPledged: 'Total amount promised, e.g. 500. Enter 0 if the amount is not known yet — payments still count; they only stop counting if this is left blank.',
  notes: 'Anything worth remembering, e.g. "Prefers to pay after Jumuah".',
} as const;

export const PAYMENT_HELP = {
  phone: "Use the same number as on the donor's pledge — dashes, spaces, brackets, dots and plus signs don't matter.",
  dateReceived: 'The date this payment came in. Record each installment separately.',
  amountReceived: 'The amount of this single payment, e.g. 200. If the same amount from this number on this date is already logged, a note below says so.',
  method: 'How the money was paid.',
  notes: 'e.g. "First installment".',
} as const;

export const NOT_A_NUMBER = 'Enter a number, e.g. 250.';
