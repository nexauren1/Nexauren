const guestView = document.getElementById('guest-view');
const userView = document.getElementById('user-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const logoutButton = document.getElementById('logout');

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function showStatus(id, message) {
  document.getElementById(id).textContent = message;
}

function renderUser(data) {
  if (!data.user) {
    guestView.classList.remove('hidden');
    userView.classList.add('hidden');
    return;
  }

  guestView.classList.add('hidden');
  userView.classList.remove('hidden');
  document.getElementById('profile-name').textContent = data.user.name || 'Nexauren member';
  document.getElementById('profile-email').textContent = data.user.email;
  document.getElementById('profile-role').textContent = data.user.role;
  document.getElementById('credit-balance').textContent = data.credits;

  const list = document.getElementById('purchases');
  if (!data.purchases.length) {
    list.innerHTML = '<div class="purchase"><span>No purchases yet.</span></div>';
    return;
  }
  list.innerHTML = data.purchases.map((item) =>
    `<div class="purchase"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.type)}</span></div>`
  ).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  }[char]));
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('login-status', 'Signing in…');
  try {
    await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginForm.email.value,
        password: loginForm.password.value,
      }),
    });
    showStatus('login-status', 'Signed in.');
    await loadAccount();
  } catch (error) {
    showStatus('login-status', error.message);
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('register-status', 'Creating account…');
  if (registerForm.password.value !== registerForm.confirm_password.value) {
    showStatus('register-status', 'Passwords do not match.');
    return;
  }
  try {
    await api('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: registerForm.name.value,
        email: registerForm.email.value,
        password: registerForm.password.value,
      }),
    });
    showStatus('register-status', 'Account created.');
    await loadAccount();
  } catch (error) {
    showStatus('register-status', error.message);
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  await loadAccount();
});

async function loadAccount() {
  try {
    const data = await api('/api/account');
    renderUser(data);
  } catch {
    renderUser({ user: null });
  }
}

document.querySelectorAll('.show-credits').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      const data = await api('/api/account');
      if (!data.user) return showStatus('login-status', 'Sign in first.');
      window.location.href = '/account/?credits=1';
    } catch (error) {
      showStatus('login-status', error.message);
    }
  });
});

loadAccount();
