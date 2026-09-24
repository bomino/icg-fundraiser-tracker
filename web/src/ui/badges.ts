import { STATUS, type Status } from '../engine';
import { h } from './dom';

const STATUS_VARIANT: Record<Status, string> = {
  [STATUS.paid]: 'badge-active',
  [STATUS.partial]: 'badge-inactive',
  [STATUS.pending]: 'badge-inactive',
  [STATUS.overpaid]: 'badge-category',
};

export function statusBadge(status: Status | null): Node | string {
  return status ? h('span', { class: `badge ${STATUS_VARIANT[status]}` }, status) : '';
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function methodBadge(method: string): Node | string {
  return method ? h('span', { class: `badge method method-${slug(method)}` }, method) : '';
}
