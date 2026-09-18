(() => {
  const host = document.getElementById("featured-books");
  if (!host) return;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;"
      }[char];
    });
  }

  function money(value, currency) {
    try {
      return Number(value || 0) > 0
        ? Number(value).toLocaleString("en-US", {
          style: "currency",
          currency: currency || "USD"
        })
        : "Grátis";
    } catch (_) {
      return Number(value || 0) > 0 ? "$" + Number(value).toFixed(2) : "Grátis";
    }
  }

  function render(books) {
    if (!books.length) {
      host.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1">' +
        '<div class="empty-icon">Aa</div>' +
        '<strong>A primeira estante está a nascer.</strong>' +
        '<p>Ainda não há títulos publicados. Assim que um livro for publicado, aparecerá aqui.</p>' +
        '<a class="book-button soft" href="/books/store/" style="margin-top:15px">Abrir a loja</a>' +
        '</div>';
      return;
    }

    host.innerHTML = books.slice(0, 4).map(function (book) {
      const cover = book.cover_url
        ? 'style="background-image:url(\'' + encodeURI(book.cover_url) + '\')"'
        : "";
      return (
        '<article class="book-card">' +
          '<a href="/books/book/?slug=' + encodeURIComponent(book.slug) + '">' +
            '<div class="book-card-cover ' + (book.cover_url ? "" : "no-cover") + '" ' + cover + '>' +
              (book.cover_url ? "" : "<span>NEXAUREN<br>STORY</span>") +
              '<button class="wish-button" type="button" data-book-id="' + escapeHtml(book.id) +
              '" aria-pressed="false" aria-label="Guardar ' + escapeHtml(book.title) + '">♡</button>' +
            '</div>' +
            '<div class="book-card-copy">' +
              '<div class="book-meta">' + escapeHtml(book.genre || "Livro") + '</div>' +
              '<h3>' + escapeHtml(book.title) + '</h3>' +
              '<p>' + escapeHtml(book.author || "Nexauren Story") + '</p>' +
              '<div class="book-card-bottom">' +
                '<span class="price">' + money(book.price_usd, book.currency) + '</span>' +
                '<span class="small-link">Ver livro →</span>' +
              '</div>' +
            '</div>' +
          '</a>' +
        '</article>'
      );
    }).join("");

    bindWishlist();
  }

  function bindWishlist() {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem("nexauren_wishlist") || "[]");
    } catch (_) {
      saved = [];
    }
    const set = new Set(saved);

    document.querySelectorAll(".wish-button").forEach(function (button) {
      const id = button.dataset.bookId;
      if (set.has(id)) {
        button.classList.add("is-saved");
        button.setAttribute("aria-pressed", "true");
        button.textContent = "♥";
      }

      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();

        if (set.has(id)) {
          set.delete(id);
          button.classList.remove("is-saved");
          button.setAttribute("aria-pressed", "false");
          button.textContent = "♡";
        } else {
          set.add(id);
          button.classList.add("is-saved");
          button.setAttribute("aria-pressed", "true");
          button.textContent = "♥";
        }

        localStorage.setItem(
          "nexauren_wishlist",
          JSON.stringify(Array.from(set))
        );
      });
    });
  }

  host.innerHTML =
    '<div class="empty-state" style="grid-column:1/-1">' +
    '<div class="empty-icon">Aa</div>' +
    '<strong>A procurar novos livros…</strong>' +
    '<p>A carregar o catálogo publicado.</p>' +
    '</div>';

  fetch("/api/books", { headers: { Accept: "application/json" } })
    .then(async function (response) {
      const raw = await response.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_) {
        throw new Error("Resposta inválida do catálogo.");
      }
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível carregar o catálogo.");
      }
      return data;
    })
    .then(function (data) {
      render(data.books || []);
    })
    .catch(function (error) {
      host.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1">' +
        '<div class="empty-icon">!</div>' +
        '<strong>O catálogo não está disponível.</strong>' +
        '<p>' + escapeHtml(error.message) + '</p>' +
        '<a class="book-button soft" href="/books/store/" style="margin-top:15px">Abrir a loja</a>' +
        '</div>';
    });
})();