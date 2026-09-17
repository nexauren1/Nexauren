const tabs = [...document.querySelectorAll('.tab')];
const views = [...document.querySelectorAll('.section-view')];

function money(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  }[char]));
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function ensureAdmin() {
  const data = await api('/api/auth/me');
  if (!data.user || data.user.role !== 'admin') {
    window.location.replace('/admin/login/');
    return null;
  }
  document.getElementById('admin-user').textContent = data.user.email;
  return data.user;
}

function listRows(items, type) {
  if (!items.length) {
    return '<div class="empty">Nothing here yet. Use the form above to create the first record.</div>';
  }
  return items.map((item) => {
    const title = escapeHtml(item.title);
    const meta = type === 'books'
      ? `${escapeHtml(item.status)} · ${money(item.price_usd)}`
      : type === 'samples'
        ? `${escapeHtml(item.type)} · ${money(item.price_usd)} · ${escapeHtml(item.status)}`
        : `${escapeHtml(item.status || 'draft')}`;
    return `<div class="list-row"><div><strong>${title}</strong><span>${meta}</span></div><span class="badge">${escapeHtml(item.id || item.slug)}</span></div>`;
  }).join('');
}

async function loadOverview() {
  const data = await api('/api/admin/overview');
  document.getElementById('m-books').textContent = data.books.total;
  document.getElementById('m-published').textContent = data.books.published;
  document.getElementById('m-users').textContent = data.platform.users;
  document.getElementById('m-orders').textContent = data.platform.orders;
  document.getElementById('m-tools').textContent = data.platform.tools;
  document.getElementById('m-posts').textContent = data.platform.posts;
  document.getElementById('s-drafts').textContent = data.books.drafts;
  document.getElementById('s-review').textContent = data.books.review;
  document.getElementById('s-published').textContent = data.books.published;
  document.getElementById('s-revenue').textContent = money(data.platform.revenue);
  document.getElementById('overview-notice').textContent = 'Connected to Nexauren D1 and ready for content creation.';
}

async function loadList(kind, target) {
  const data = await api(`/api/admin/${kind}`);
  target.innerHTML = listRows(data.items || [], kind);
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function submitForm(form, kind) {
  const submit = form.querySelector('button[type="submit"]');
  const original = submit.textContent;
  submit.disabled = true;
  submit.textContent = 'Saving…';
  try {
    await api(`/api/admin/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formObject(form)),
    });
    form.reset();
    await loadList(kind, document.getElementById(`${kind}-list`));
    await loadOverview();
  } catch (error) {
    window.alert(error.message);
  } finally {
    submit.disabled = false;
    submit.textContent = original;
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    const section = tab.dataset.section;
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    views.forEach((view) => view.classList.toggle('hidden', view.id !== `section-${section}`));

    try {
      if (section === 'books') await loadList('books', document.getElementById('books-list'));
      if (section === 'tools') await loadList('tools', document.getElementById('tools-list'));
      if (section === 'samples') await loadList('samples', document.getElementById('samples-list'));
      if (section === 'blog') await loadList('blog', document.getElementById('blog-list'));
    } catch (error) {
      window.alert(error.message);
    }
  });
});

document.getElementById('book-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, 'books');
});
document.getElementById('tool-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, 'tools');
});
document.getElementById('sample-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, 'samples');
});
document.getElementById('blog-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, 'blog');
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.replace('/admin/login/');
});

(async () => {
  try {
    const user = await ensureAdmin();
    if (!user) return;
    await loadOverview();
  } catch (error) {
    window.location.replace('/admin/login/');
  }
})();
