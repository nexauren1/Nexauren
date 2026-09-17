const params = new URLSearchParams(location.search);
const slug = params.get('slug');
const main = document.querySelector('.product');
const title = document.querySelector('.product h1');
const lead = document.querySelector('.product-lead');
const price = document.querySelector('.price');
const cover = document.querySelector('.cover-placeholder');
const metaRow = document.querySelector('.meta-row');
const note = document.querySelector('.placeholder-note');
const description = document.querySelector('.detail-grid .detail:nth-child(1) p');
const author = document.querySelector('.detail-grid .detail:nth-child(2) p');
const formats = document.querySelector('.detail-grid .detail:nth-child(3) p');
const preview = document.querySelector('.detail-grid .detail:nth-child(4) p');

function money(value, currency = 'USD') {
  return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  }[char]));
}

function setError(message) {
  main.innerHTML = `<div class="product-copy"><p class="books-kicker">BOOKS</p><h1>Book unavailable.</h1><p class="product-lead">${escapeHtml(message)}</p><a class="book-button soft" href="../store/">Back to store</a></div>`;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function loadPaypal(clientId) {
  return new Promise((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal);
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    script.onload = () => resolve(window.paypal);
    script.onerror = () => reject(new Error('Could not load PayPal Checkout.'));
    document.head.appendChild(script);
  });
}

async function renderBook(book) {
  document.title = `${book.title} — Nexauren Books`;
  title.textContent = book.title;
  lead.textContent = book.description || book.premise || 'A Nexauren Books digital title.';
  price.textContent = book.product ? money(book.product.price_usd, book.product.currency) : money(book.price_usd, book.currency);
  author.textContent = book.author || 'Nexauren';
  description.textContent = book.description || 'Description will be updated by the Books publishing workspace.';
  formats.textContent = [book.pdf_available ? 'PDF' : null, book.epub_available ? 'EPUB' : null].filter(Boolean).join(' · ') || 'Digital format pending';
  preview.textContent = book.preview_url ? 'Preview available.' : 'Preview will be added when provided.';
  metaRow.innerHTML = [book.genre, book.language, book.age_rating, formats.textContent]
    .filter(Boolean).map((item) => `<span class="meta">${escapeHtml(item)}</span>`).join('');

  if (book.cover_url) {
    cover.style.backgroundImage = `url('${encodeURI(book.cover_url)}')`;
    cover.textContent = '';
  } else {
    cover.innerHTML = `<div><span>NEXAUREN BOOKS</span><strong>${escapeHtml(book.title)}</strong></div>`;
  }

  const purchaseBox = document.querySelector('.purchase-box');
  if (!book.product) {
    note.textContent = 'This title is not configured as a purchasable product yet.';
    return;
  }

  note.innerHTML = 'Sign in is required before checkout. Payment is confirmed server-side through PayPal.';
  const buttonHost = document.createElement('div');
  buttonHost.id = 'paypal-button-container';
  buttonHost.style.marginTop = '14px';
  purchaseBox.appendChild(buttonHost);

  const account = await api('/api/account');
  if (!account.user) {
    const signIn = document.createElement('a');
    signIn.className = 'book-button soft';
    signIn.href = '../../account/';
    signIn.textContent = 'Sign in to buy';
    buttonHost.replaceWith(signIn);
    return;
  }

  const config = await api('/api/paypal/config');
  if (!config.configured) {
    buttonHost.innerHTML = '<p class="placeholder-note">PayPal is not configured on the Worker yet.</p>';
    return;
  }

  const paypal = await loadPaypal(config.client_id);
  paypal.Buttons({
    style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
    async createOrder() {
      const data = await api('/api/paypal/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: book.product.id }),
      });
      return data.id;
    },
    async onApprove(data) {
      note.textContent = 'Confirming your payment…';
      await api('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: data.orderID }),
      });
      note.textContent = 'Payment completed. Your purchase is now attached to your Nexauren account.';
    },
    onCancel() {
      note.textContent = 'Checkout cancelled.';
    },
    onError(error) {
      console.error(error);
      note.textContent = 'PayPal could not complete this checkout.';
    },
  }).render('#paypal-button-container');
}

(async () => {
  try {
    if (!slug) throw new Error('No book was selected.');
    const data = await api(`/api/books/${encodeURIComponent(slug)}`);
    await renderBook(data.book);
  } catch (error) {
    setError(error.message);
  }
})();
