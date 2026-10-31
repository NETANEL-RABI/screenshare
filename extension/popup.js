const $ = (id) => document.getElementById(id);

// מנקה ומשלים את הכתובת (מוסיף https אם חסר)
function normalize(raw) {
  let v = (raw || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) {
    v = (/^(localhost|127\.0\.0\.1)/i.test(v) ? 'http://' : 'https://') + v;
  }
  try {
    return new URL(v).origin;
  } catch {
    return null;
  }
}

async function save() {
  const url = normalize($('url').value);
  if (!url) {
    $('msg').textContent = 'כתובת לא תקינה';
    return null;
  }
  await chrome.storage.sync.set({ serverUrl: url });
  $('url').value = url;
  $('msg').textContent = '';
  return url;
}

$('open-window').onclick = async () => {
  const url = await save();
  if (!url) return;
  // חלון נפרד: ממשיך לעבוד גם כשהתוסף נסגר
  chrome.windows.create({ url, type: 'popup', width: 900, height: 700 });
  window.close();
};

$('open-tab').onclick = async () => {
  const url = await save();
  if (!url) return;
  chrome.tabs.create({ url });
  window.close();
};

chrome.storage.sync.get('serverUrl').then(({ serverUrl }) => {
  if (serverUrl) $('url').value = serverUrl;
});
