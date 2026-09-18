const form = document.getElementById('admin-login-form');
const statusBox = document.getElementById('login-status');

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('O servidor devolveu uma resposta inválida.');
  }
}

async function checkSession() {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const data = await readJson(response);
    if (response.ok && data.user?.role === 'admin') {
      window.location.replace('/admin/');
    }
  } catch {
    // O formulário continua disponível.
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  statusBox.textContent = 'A confirmar acesso…';

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
      throw new Error(data.error || 'Não foi possível iniciar sessão.');
    }
    if (data.user?.role !== 'admin') {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      throw new Error('Esta conta não tem acesso de administrador.');
    }

    const confirmResponse = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const confirmData = await readJson(confirmResponse);

    if (!confirmResponse.ok || confirmData.user?.role !== 'admin') {
      throw new Error('A sessão de administrador não foi confirmada. Tenta novamente.');
    }

    statusBox.textContent = 'Acesso confirmado. A abrir o Admin…';
    window.location.replace('/admin/');
  } catch (error) {
    statusBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

checkSession();
