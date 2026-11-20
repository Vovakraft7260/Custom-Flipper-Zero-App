// "Update available" prompt and the "check for updates" button.
import { h, sheet, toast } from './dom.js';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { checkForUpdate, openUpdate, skipUpdate } from '../update.js';

export async function offerUpdate(update) {
  const notes = update.notes.trim().split('\n').slice(0, 6).join('\n');
  const choice = await sheet(
    `update available: build ${update.build}`,
    [
      { label: '⬇ download & install', class: 'primary', value: 'get' },
      { label: 'skip this version', value: 'skip' },
    ],
    h('p', { class: 'muted', style: 'white-space:pre-wrap' },
      notes || 'A newer version of 0ilrig Trmnl is ready.',
      '\n\nAfter it downloads, tap the file and choose "Update". Your saved settings stay.'),
  );
  if (choice === 'get') openUpdate(update);
  if (choice === 'skip') skipUpdate(update);
}

/** Quiet check when the app opens. */
export async function checkOnStart() {
  const update = await checkForUpdate();
  if (update) offerUpdate(update);
}

/** Small "app version + check for updates" block for the device screen. */
export function updatesCard() {
  if (!Capacitor.isNativePlatform()) return null;
  const version = h('span', { class: 'muted' }, 'app version …');
  App.getInfo().then((i) => (version.textContent = `app version ${i.version} (build ${i.build})`)).catch(() => {});
  const btn = h('button', {
    onclick: async () => {
      btn.disabled = true;
      btn.textContent = 'checking…';
      const update = await checkForUpdate({ force: true });
      btn.disabled = false;
      btn.textContent = 'check for updates';
      if (update) offerUpdate(update);
      else toast("You're up to date (or offline).");
    },
  }, 'check for updates');
  return h('div', { class: 'card', style: 'margin-top:24px' }, version, h('div', { style: 'margin-top:8px' }, btn));
}
