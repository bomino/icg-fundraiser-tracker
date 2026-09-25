// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { field, type FieldOptions } from '../../web/src/ui/field';

describe('field', () => {
  it('announces the error via aria-describedby and keeps the help id once the error clears', () => {
    const f = field({ name: 'name', label: 'Name', value: '', help: 'Digits only.' });
    const helpId = f.wrapper.querySelector('.help')!.id;
    const errorEl = f.wrapper.querySelector('.field-error')!;

    f.setError('Required.');
    let ids = (f.input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids).toContain(errorEl.id);
    expect(errorEl.textContent).toBe('Required.');
    expect(ids).toContain(helpId);

    f.setError(undefined);
    ids = (f.input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids).not.toContain(errorEl.id);
    expect(ids).toContain(helpId);
  });

  it('sets aria-required on required fields, and omits it otherwise', () => {
    const required = field({ name: 'phone', label: 'Phone', value: '', required: true });
    expect(required.input.getAttribute('aria-required')).toBe('true');

    const optional = field({ name: 'notes', label: 'Notes', value: '' });
    expect(optional.input.getAttribute('aria-required')).toBeNull();
  });

  it('lets typed text and notes run right-to-left when they start in Arabic script, leaving phone, date and choice fields alone', () => {
    const types: FieldOptions['type'][] = [undefined, 'text', 'textarea', 'tel', 'date', 'select'];
    expect(types.map((type) => field({ name: 'x', label: 'X', value: '', type, options: [] }).input.getAttribute('dir'))).toEqual(['auto', 'auto', 'auto', null, null, null]);
  });
});
