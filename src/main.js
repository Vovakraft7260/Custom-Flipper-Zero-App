// 0ilrig Trmnl — app entry: tabs, connection status, phone back button.
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { conn, onConnChange } from './connection.js';
import { popBack } from './ui/dom.js';
import { deviceView } from './ui/device.js';
import { toolsView, toolsBack, resetTools, setOnRunScript } from './ui/tools.js';
import { resetFiles } from './ui/files.js';
import { remoteView, stopRemote } from './ui/remote.js';
import { checkOnStart } from './ui/updates.js';

const views = { device: deviceView, tools: toolsView, remote: remoteView };
let current = 'device';
const tabHistory = []; // tabs visited before, for the back button

const view = document.getElementById('view');
const status = document.getElementById('status');
const tabs = document.getElementById('tabs');

async function show(tab, { remember = true } = {}) {
  if (tab === current) return render();
  if (current === 'remote') await stopRemote();
  if (remember) {
    tabHistory.push(current);
    if (tabHistory.length > 20) tabHistory.shift();
  }
  current = tab;
  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab);
  render();
}

function render() {
  view.replaceChildren(views[current](render));
}

tabs.addEventListener('click', (e) => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (tab) show(tab);
});

// After "run" on a script, show the Flipper screen.
setOnRunScript(() => show('remote'));

/**
 * Phone back button, step by step:
 * open sheet/editor → inside a tool (folders, then the tool) → previous tab → leave the app.
 */
function goBack() {
  if (popBack()) return;
  if (current === 'tools' && toolsBack()) return;
  const prev = tabHistory.pop();
  if (prev) return show(prev, { remember: false });
  App.minimizeApp(); // keeps the Flipper connected in the background
}

if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', goBack);
}
// Browser preview: Escape acts as the back button.
window.addEventListener('keydown', (e) => e.key === 'Escape' && goBack());

let lastState = conn.state;
onConnChange((c) => {
  status.className = `status ${c.state === 'online' ? 'on' : c.state === 'connecting' ? 'busy' : 'off'}`;
  status.textContent = c.state === 'online' ? c.name.replace(/^Flipper\s*/, '') || 'online' : c.state;
  if (c.state !== lastState) {
    resetFiles();
    resetTools();
    if (c.state === 'offline') {
      stopRemote();
      tabHistory.length = 0;
      if (current !== 'device') show('device', { remember: false });
      else render();
    } else if (c.state === 'online') {
      render();
    }
  }
  lastState = c.state;
});

render();
checkOnStart();
