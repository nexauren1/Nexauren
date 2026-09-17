(() => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const toggle = document.querySelector('.books-menu-toggle');
  const nav = document.getElementById('books-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('is-open', !open);
    });

    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
      });
    });
  }

  const homeCatalog = document.getElementById('home-catalog');
  if (!homeCatalog) return;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#039;',
      '"': '&quot;',
    }[char]));
  }

  function money(value, currency = 'USD') {
    return Number(value || 0).toLocaleString('en-US', {
      style: 'currency',
      currency,
    });
  }

  function renderBooks(books) {
    if (!books.length) {
      homeCatalog.innerHTML = `
        <div class="catalog-loading empty-live-catalog">
          <div class="empty-mark" aria-hidden="true">✦</div>
          <strong>The catalogue is growing.</strong>
          <span>New published books will appear here automatically.</span>
          <a class="book-button soft" href="store/">Open Store</a>
        </div>
      `;
      return;
    }

    const featured = books.slice(0, 3);
    homeCatalog.innerHTML = `
      <div class="home-catalog-grid">
        ${featured.map((book) => `
          <article class="home-book-card">
            <a href="book/?slug=${encodeURIComponent(book.slug)}" aria-label="Open ${escapeHtml(book.title)}">
              <div class="home-book-cover" ${book.cover_url ? `style="background-image:url('${encodeURI(book.cover_url)}')"` : ''}>
                ${book.cover_url ? '' : `<span>NEXAUREN<br>BOOKS</span>`}
              </div>
              <div class="home-book-copy">
                <span class="books-kicker">${escapeHtml(book.genre || 'BOOK')}</span>
                <h3>${escapeHtml(book.title)}</h3>
                <p>${escapeHtml(book.author || 'Nexauren')}</p>
                <strong>${Number(book.price_usd || 0) > 0 ? money(book.price_usd, book.currency) : 'Free'}</strong>
              </div>
            </a>
          </article>
        `).join('')}
      </div>
      <div class="catalog-actions">
        <a class="book-button primary" href="store/">View all books <span aria-hidden="true">→</span></a>
      </div>
    `;
  }

  async function loadCatalogue() {
    try {
      const response = await fetch('/api/books', {
        headers: { Accept: 'application/json' },
      });
      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('Catalogue returned an invalid response.');
      }
      if (!response.ok) throw new Error(data.error || 'Catalogue unavailable.');
      renderBooks(data.books || []);
    } catch (error) {
      homeCatalog.innerHTML = `
        <div class="catalog-loading empty-live-catalog">
          <div class="empty-mark" aria-hidden="true">!</div>
          <strong>Catalogue unavailable.</strong>
          <span>${escapeHtml(error.message)}</span>
          <a class="book-button soft" href="store/">Open Store</a>
        </div>
      `;
    }
  }

  loadCatalogue();
})();
