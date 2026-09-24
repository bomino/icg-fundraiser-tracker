import { parseAmount } from '../format';
import { amountError } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm } from './form';
import { NOT_A_NUMBER } from './help';

export function openGoalForm(goal: number | null, onSave: (goal: number) => Promise<void>, reportError: (err: unknown) => void): void {
  const goalField = field({ name: 'goal', label: 'Fundraiser goal ($)', inputmode: 'decimal', value: goal?.toString() ?? '', help: '% of goal received is measured against this figure.' });
  runForm<{ goal: number | null }>({
    title: 'Edit goal',
    form: h('form', { class: 'form' }, goalField.wrapper),
    fields: { goal: goalField },
    read() {
      const amount = parseAmount(goalField.input.value);
      return { draft: { goal: amount === 'invalid' ? null : amount }, errors: amount === 'invalid' ? { goal: NOT_A_NUMBER } : {} };
    },
    validate: (draft) => {
      const error = draft.goal === null ? 'Enter a goal.' : amountError(draft.goal);
      return error ? { goal: error } : {};
    },
    onSave: (draft) => onSave(draft.goal ?? 0),
    deleteMessage: '',
    reportError,
  });
}
