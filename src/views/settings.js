import { setLocationByAddress } from './map.js';
import { initGeneration } from './generation.js';

const STORE_KEY = 'bxl_energy_settings';
let generationInited = false;
let settingsInited = false;

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
  } catch { return {}; }
}

function saveSettings(patch) {
  const s = loadSettings();
  localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, ...patch }));
}

// Called from consumption.js after tips are generated
export function maybeNotifyTips(tips) {
  const { notifThreshold, notifEnabled } = loadSettings();
  if (!notifEnabled || notifThreshold == null) return;
  if (Notification.permission !== 'granted') return;

  const best = tips.reduce((a, b) => (b.monthlySaving ?? 0) > (a.monthlySaving ?? 0) ? b : a, tips[0]);
  if (!best || (best.monthlySaving ?? 0) < notifThreshold) return;

  new Notification('Brussels Energy Reality', {
    body: `💡 You could save €${(best.monthlySaving ?? 0).toFixed(2)}/month by shifting your ${best.appId?.replace('_', ' ') ?? 'appliance'} usage.`,
    icon: '/favicon.ico',
  });
}

export function initSettings() {
  initSubTabs();
  if (!settingsInited) {
    wireGeneralPanel();
    settingsInited = true;
  }
}

function initSubTabs() {
  const tabs   = document.querySelectorAll('.settings-sidetab');
  const panels = document.querySelectorAll('.settings-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.panel;

      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panels.forEach(p => {
        const isTarget = p.id === `settings-panel-${target}`;
        p.classList.toggle('active', isTarget);
        p.classList.toggle('hidden', !isTarget);
      });

      if ((target === 'datagen' || target === 'appliances') && !generationInited) {
        initGeneration();
        generationInited = true;
      }
    });
  });
}

function wireGeneralPanel() {
  const addressInput  = document.getElementById('settings-address');
  const addressBtn    = document.getElementById('settings-address-save');
  const addressStatus = document.getElementById('settings-address-status');
  const thresholdInput = document.getElementById('settings-threshold');
  const thresholdBtn  = document.getElementById('settings-threshold-save');
  const notifBtn      = document.getElementById('settings-notif-enable');
  const notifStatus   = document.getElementById('settings-notif-status');

  if (!addressInput) return;

  const saved = loadSettings();
  if (saved.locationAddress) addressInput.value = saved.locationAddress;
  if (saved.notifThreshold != null) thresholdInput.value = saved.notifThreshold;

  updateNotifStatus(notifStatus, notifBtn);

  addressBtn.addEventListener('click', async () => {
    const query = addressInput.value.trim();
    if (!query) return;
    addressBtn.disabled = true;
    addressBtn.textContent = 'Searching…';
    addressStatus.textContent = '';
    try {
      await setLocationByAddress(query);
      saveSettings({ locationAddress: query });
      addressStatus.dataset.ok = 'true';
      addressStatus.textContent = '✓ Location updated on the map';
    } catch {
      addressStatus.dataset.ok = 'false';
      addressStatus.textContent = 'Address not found in Belgium';
    } finally {
      addressBtn.disabled = false;
      addressBtn.textContent = 'Save';
    }
  });

  addressInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addressBtn.click();
  });

  thresholdBtn.addEventListener('click', () => {
    const val = parseFloat(thresholdInput.value);
    if (isNaN(val) || val < 0) return;
    saveSettings({ notifThreshold: val });
    thresholdBtn.textContent = '✓ Saved';
    setTimeout(() => { thresholdBtn.textContent = 'Save'; }, 1500);
  });

  notifBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      notifStatus.textContent = 'Notifications not supported in this browser.';
      return;
    }
    const perm = await Notification.requestPermission();
    saveSettings({ notifEnabled: perm === 'granted' });
    updateNotifStatus(notifStatus, notifBtn);
  });
}

function updateNotifStatus(statusEl, btn) {
  if (!('Notification' in window)) {
    statusEl.textContent = 'Not supported in this browser.';
    btn.disabled = true;
    return;
  }
  const { notifEnabled } = loadSettings();
  const perm = Notification.permission;

  if (perm === 'granted' && notifEnabled) {
    statusEl.dataset.ok = 'true';
    statusEl.textContent = '✓ Notifications enabled';
    btn.textContent = 'Disable notifications';
  } else if (perm === 'denied') {
    statusEl.dataset.ok = 'false';
    statusEl.textContent = 'Blocked by browser — allow in site settings and reload.';
    btn.disabled = true;
  } else {
    statusEl.dataset.ok = '';
    statusEl.textContent = 'Not yet enabled.';
    btn.textContent = 'Enable notifications';
  }
}
