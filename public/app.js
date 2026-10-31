const $ = (id) => document.getElementById(id);
let mode = 'login';

function setMode(m) {
  mode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('submit').textContent = m === 'login' ? 'התחבר' : 'הירשם';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('error').textContent = '';
}

function showApp(username) {
  $('who').textContent = username;
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  window.Share.onLogin();
}
function showAuth() {
  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה');
  return data;
}

$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');

$('submit').onclick = async () => {
  $('error').textContent = '';
  try {
    const data = await api(mode === 'login' ? '/api/login' : '/api/register', {
      username: $('username').value.trim(),
      password: $('password').value,
    });
    $('password').value = '';
    showApp(data.username);
  } catch (e) {
    $('error').textContent = e.message;
  }
};

$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('submit').click(); });

$('logout').onclick = async () => {
  window.Share.stop();
  await api('/api/logout', {});
  showAuth();
};

api('/api/me').then((d) => showApp(d.username)).catch(() => showAuth());
