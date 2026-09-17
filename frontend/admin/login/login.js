const form = document.getElementById('admin-login-form');
const statusBox = document.getElementById('login-status');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusBox.textContent = 'Checking access…';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value,
      }),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Could not sign in.');
    if (data.user?.role !== 'admin') {
      await fetch('/api/auth/logout', { method: 'POST' });
      throw new Error('This account does not have admin access.');
    }

    window.location.replace('/admin/');
  } catch (error) {
    statusBox.textContent = error.message;
  }
});
