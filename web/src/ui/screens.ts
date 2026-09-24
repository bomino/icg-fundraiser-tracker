import { h } from './dom';

export interface Message {
  title: string;
  body: string;
  action?: { label: string; run(): void };
}

export function renderMessageScreen(root: HTMLElement, message: Message): void {
  const button = message.action ? h('button', { type: 'button', class: 'btn btn-primary' }, message.action.label) : null;
  if (button && message.action) button.addEventListener('click', message.action.run);
  root.replaceChildren(h('main', { class: 'signin card-elevated' }, h('h1', { class: 'display-md' }, message.title), h('p', { class: 'body-md ink-soft' }, message.body), button));
}

export function renderLoading(root: HTMLElement): void {
  root.replaceChildren(
    h('main', { class: 'container', 'aria-busy': 'true' }, h('p', { class: 'eyebrow' }, 'Loading the tracker…'), h('div', { class: 'grid-stats' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }))),
  );
}
