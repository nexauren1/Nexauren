(() => {
  const host = document.getElementById("library-content");
  if (!host) return;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, function (char) {
      return {
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        "'": "&#039;", '"': "&quot;"
      }[char];
    });
  }

  function empty(title, text, action) {
    host.innerHTML =
      '<div class="empty-state">' +
      '<div class="empty-icon">Aa</div>' +
      '<strong>' + escapeHtml(title) + '</strong>' +
      '<p>' + escapeHtml(text) + '</p>' +
      (action ? '<a class="book-button primary" href="/books/store/" style="margin-top:15px">Explorar a loja →</a>' : "") +
      '</div>';
  }

  function render(catalogue, purchases) {
    const map = new Map((catalogue || []).map(function (book) {
      return [String(book.id), book];
    }));

    const owned = (purchases || [])
      .filter(function (purchase) { return purchase.type === "book"; })
      .map(function (purchase) {
        const id = String(purchase.product_id || "").replace(/^prd_book_/, "");
        return { purchase: purchase, book: map.get(id) };
      })
      .filter(function (item) { return item.book; });

    if (!owned.length) {
      empty(
        "Ainda não há livros na sua biblioteca.",
        "Quando adquirir uma edição, ela aparecerá aqui com acesso aos formatos disponíveis.",
        true
      );
      return;
    }

    host.innerHTML =
      '<h2>Os seus livros</h2>' +
      '<p>' + owned.length + " " + (owned.length === 1 ? "título disponível" : "títulos disponíveis") + '.</p>' +
      '<div class="library-grid">' +
      owned.map(function (item) {
        const book = item.book;
        const purchase = item.purchase;
        const cover = book.cover_url
          ? 'style="background-image:url(\'' + encodeURI(book.cover_url) + '\')"'
          : "";
        return (
          '<article class="library-item">' +
            '<div class="library-cover" ' + cover + '></div>' +
            '<div>' +
              '<h3>' + escapeHtml(book.title) + '</h3>' +
              '<p>' + escapeHtml(book.author || "Nexauren Story") + '</p>' +
              '<div class="library-links">' +
                '<a href="/books/book/?slug=' + encodeURIComponent(book.slug) + '">Ver livro</a>' +
                (book.pdf_available ? '<a href="/api/books/' + encodeURIComponent(book.slug) + '/download?format=pdf">PDF</a>' : "") +
                (book.epub_available ? '<a href="/api/books/' + encodeURIComponent(book.slug) + '/download?format=epub">EPUB</a>' : "") +
              '</div>' +
              '<p style="margin-top:8px">Compra em ' +
                new Date(Number(purchase.created_at || 0) * 1000).toLocaleDateString("pt-PT") +
              '</p>' +
            '</div>' +
          '</article>'
        );
      }).join("") +
      '</div>';
  }

  Promise.all([
    fetch("/api/account", { headers: { Accept: "application/json" } }).then(function (response) { return response.json(); }),
    fetch("/api/books", { headers: { Accept: "application/json" } }).then(function (response) { return response.json(); })
  ])
    .then(function (results) {
      const account = results[0];
      const catalogue = results[1];
      if (!account.user) {
        empty(
          "Entre para ver a sua biblioteca.",
          "As suas compras e edições digitais ficam ligadas à sua conta Nexauren Story.",
          false
        );
        host.querySelector(".empty-state").insertAdjacentHTML(
          "beforeend",
          '<a class="book-button primary" href="/account/" style="margin-top:15px">Entrar na conta →</a>'
        );
        return;
      }
      render(catalogue.books || [], account.purchases || []);
    })
    .catch(function () {
      empty("Não foi possível abrir a biblioteca.", "Tente novamente mais tarde.", false);
    });
})();