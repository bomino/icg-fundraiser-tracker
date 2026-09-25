import { h } from './dom';

export interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  setError(message: string | undefined): void;
}

export interface FieldOptions {
  name: string;
  label: string;
  value: string;
  help?: string;
  type?: 'text' | 'tel' | 'date' | 'textarea' | 'select';
  inputmode?: string;
  options?: readonly string[];
  required?: boolean;
}

let fieldCount = 0;

export function field(options: FieldOptions): Field {
  const id = `field-${options.name}-${++fieldCount}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  let input: Field['input'];
  // A name or note typed in Arabic script should align and punctuate right-to-left. Phones and dates
  // have no letters to take a direction from, so only free-text boxes get dir=auto.
  if (options.type === 'textarea') {
    input = h('textarea', { id, name: options.name, class: 'input', rows: 3, dir: 'auto' });
  } else if (options.type === 'select') {
    // Keep a value that is no longer in the list so opening an old payment does not silently change it.
    const choices = options.options ?? [];
    const values = options.value && !choices.includes(options.value) ? [...choices, options.value] : choices;
    input = h('select', { id, name: options.name, class: 'input' }, h('option', { value: '' }, '— none —'), ...values.map((value) => h('option', { value }, value)));
  } else {
    const type = options.type ?? 'text';
    input = h('input', { id, name: options.name, class: 'input', type, inputmode: options.inputmode, autocomplete: 'off', dir: type === 'text' ? 'auto' : undefined });
  }
  input.value = options.value;
  if (options.required) input.setAttribute('aria-required', 'true');
  const error = h('p', { class: 'field-error', id: errorId, role: 'alert', hidden: true });
  const syncDescribedBy = () => {
    const ids = [options.help ? helpId : null, error.hidden ? null : errorId].filter((value): value is string => value !== null);
    if (ids.length > 0) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  };
  syncDescribedBy();
  const wrapper = h(
    'div',
    { class: 'field' },
    h('label', { for: id, class: 'label' }, options.label, options.required ? h('span', { class: 'required', 'aria-hidden': 'true' }, ' *') : null),
    input,
    options.help ? h('p', { class: 'help', id: helpId }, options.help) : null,
    error,
  );
  return {
    wrapper,
    input,
    setError(message) {
      error.hidden = !message;
      error.textContent = message ?? '';
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      syncDescribedBy();
    },
  };
}
