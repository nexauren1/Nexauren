const searchInput = document.querySelector('.search');
const sortSelect = document.querySelector('.filter');
const empty = document.querySelector('.catalog-empty');
let books = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  }[char]));
}

function money(value, currency = 'USD') {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency', currency,
  });
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  let filtered = books.filter((book) => {
    const haystack = [book.title, book.author, book.genre, book.subgenre].join(' ').toLowerCase();
    return haystack.includes(query);
  });

  if (sortSelect.value === 'Newest') {
    filtered = [...filtered].sort((a, b) => Number(b.published_at || 0) - Number(a.published_at || 0));
  }
  if (sortSelect.value === 'Price: low to high') {
    filtered = [...filtered].sort((a, b) => Number(a.price_usd) - Number(b.price_usd));
  }
  if (sortSelect.value === 'Price: high to low') {
    filtered = [...filtered].sort((a, b) => Number(b.price_usd) - Number(a.price_usd));
  }

  if (!filtered.length) {
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-mark" aria-hidden="true" style="margin:0 auto">✦</div><h2>${books.length ? 'No books match your search.' : 'Your catalogue starts here.'}</h2><p>${books.length ? 'Try another title, author or category.' : 'Published books from the Nexauren Books system will appear here automatically.'}</p>`;
    return;
  }

  empty.hidden = true;
  let grid = document.querySelector('.catalog-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'catalog-grid';
    empty.parentNode.insertBefore(grid, empty);
  }

  grid.innerHTML = filtered.map((book) => `
    <article class="book-card">
      <a href="../book/?slug=${encodeURIComponent(book.slug)}" aria-label="Open ${escapeHtml(book.title)}">
        <div class="book-card-cover" style="${book.cover_url ? `background-image:url('${encodeURI(book.cover_url)}')` : ''}">
          ${book.cover_url ? '' : `<span>NEXAUREN<br>BOOKS</span>`}
        </div>
        <div class="book-card-copy">
          <span class="books-kicker">${escapeHtml(book.genre || 'BOOK')}</span>
          <h2>${escapeHtml(book.title)}</h2>
          <p>${escapeHtml(book.author || 'Nexauren')}</p>
          <strong>${money(book.price_usd, book.currency)}</strong>
        </div>
      </a>
    </article>`).join('');
}

async function load() {
  try {
    const response = await fetch('/api/books');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load catalogue.');
    books = data.books || [];
    render();
  } catch (error) {
    empty.hidden = false;
    empty.innerHTML = `<div class="empty-mark" aria-hidden="true" style="margin:0 auto">!</div><h2>Catalogue unavailable.</h2><p>${escapeHtml(error.message)}</p>`;
  }
}

searchInput.addEventListener('input', render);
sortSelect.addEventListener('change', render);
load();
