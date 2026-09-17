const form = document.getElementById('admin-login-form');
const statusBox = document.getElementById('login-status');

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('The Admin service returned an invalid response.');
  }
}

async function checkAdminSession() {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const data = await readJson(response);
    if (response.ok && data.user?.role === 'admin') {
      window.location.replace('/admin/');
      return true;
    }
  } catch {
    // The login form remains available when the session check cannot run.
  }
  return false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusBox.textContent = 'Checking access…';

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value,
      }),
    });
    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(data.error || 'Could not sign in.');
    }

    if (data.user?.role !== 'admin') {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      throw new Error('This account does not have admin access.');
    }

    statusBox.textContent = 'Access confirmed. Opening Admin Studio…';

    // Confirm the new HttpOnly session before navigating to the protected page.
    const sessionResponse = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const sessionData = await readJson(sessionResponse);

    if (!sessionResponse.ok || sessionData.user?.role !== 'admin') {
      throw new Error(
        'The admin session was not saved. Please refresh and sign in again.',
      );
    }

    window.location.replace('/admin/');
  } catch (error) {
    statusBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

checkAdminSession();
