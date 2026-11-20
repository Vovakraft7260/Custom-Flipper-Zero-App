// 0ilrig Trmnl — app entry: tabs + connection status.
import { conn, onConnChange } from './connection.js';
import { deviceView } from './ui/device.js';
import { filesView, resetFiles } from './ui/files.js';
import { remoteView, stopRemote } from './ui/remote.js';

const views = { device: deviceView, files: filesView, remote: remoteView };
let current = 'device';

const view = document.getElementById('view');
const status = document.getElementById('status');
const tabs = document.getElementById('tabs');

async function show(tab) {
  if (current === 'remote' && tab !== 'remote') await stopRemote();
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

let lastState = conn.state;
onConnChange((c) => {
  status.className = `status ${c.state === 'online' ? 'on' : c.state === 'connecting' ? 'busy' : 'off'}`;
  status.textContent = c.state === 'online' ? c.name.replace(/^Flipper\s*/, '') || 'online' : c.state;
  if (c.state !== lastState) {
    resetFiles();
    if (c.state === 'offline') {
      stopRemote();
      if (current !== 'device') show('device');
      else render();
    } else if (c.state === 'online') {
      render();
    }
  }
  lastState = c.state;
});

render();
