(() => {
  const grid = document.getElementById("catalog-grid");
  const form = document.getElementById("catalog-filters");
  const search = document.getElementById("search");
  const genre = document.getElementById("genre");
  const language = document.getElementById("language");
  const sort = document.getElementById("sort");
  const count = document.getElementById("catalog-count");
  const note = document.getElementById("result-note");

  if (!grid || !form) return;

  const params = new URLSearchParams(location.search);
  search.value = params.get("q") || "";
  const initialGenre = params.get("genre") || "";
  let books = [];

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, function (char) {
      return {
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        "'": "&#039;", '"': "&quot;"
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

  function unique(key) {
    return Array.from(new Set(
      books.map(function (book) {
        return String(book[key] || "").trim();
      }).filter(Boolean)
    )).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  function fill(select, values) {
    const current = select.value;
    select.innerHTML = '<option value="">Todos</option>' +
      values.map(function (value) {
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }).join("");
    if (values.indexOf(current) >= 0) select.value = current;
  }

  function matches(book) {
    const query = search.value.trim().toLowerCase();
    const haystack = [
      book.title, book.author, book.genre, book.subgenre, book.description
    ].join(" ").toLowerCase();

    if (query && haystack.indexOf(query) === -1) return false;
    if (genre.value &&
        String(book.genre || "").toLowerCase() !== genre.value.toLowerCase()) {
      return false;
    }
    if (language.value &&
        String(book.language || "").toLowerCase() !== language.value.toLowerCase()) {
      return false;
    }
    return true;
  }

  function sortBooks(items) {
    const output = items.slice();

    if (sort.value === "newest") {
      return output.sort(function (a, b) {
        return Number(b.published_at || 0) - Number(a.published_at || 0);
      });
    }
    if (sort.value === "price-low") {
      return output.sort(function (a, b) {
        return Number(a.price_usd || 0) - Number(b.price_usd || 0);
      });
    }
    if (sort.value === "price-high") {
      return output.sort(function (a, b) {
        return Number(b.price_usd || 0) - Number(a.price_usd || 0);
      });
    }
    if (sort.value === "title") {
      return output.sort(function (a, b) {
        return String(a.title || "").localeCompare(String(b.title || ""));
      });
    }
    return output;
  }

  function card(book) {
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
              '<span class="small-link">Abrir →</span>' +
            '</div>' +
          '</div>' +
        '</a>' +
      '</article>'
    );
  }

  function bindWishlist() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem("nexauren_wishlist") || "[]"); }
    catch (_) { saved = []; }
    const set = new Set(saved);

    grid.querySelectorAll(".wish-button").forEach(function (button) {
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
        localStorage.setItem("nexauren_wishlist", JSON.stringify(Array.from(set)));
      });
    });
  }

  function render() {
    const filtered = sortBooks(books.filter(matches));
    count.textContent = filtered.length + " " +
      (filtered.length === 1 ? "livro encontrado" : "livros encontrados");

    const filters = [];
    if (search.value.trim()) filters.push("“" + search.value.trim() + "”");
    if (genre.value) filters.push(genre.value);
    if (language.value) filters.push(language.value);
    note.textContent = filters.length
      ? "Filtros ativos: " + filters.join(" · ")
      : "Catálogo publicado";

    if (!filtered.length) {
      grid.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1">' +
        '<div class="empty-icon">⌕</div>' +
        '<strong>' + (books.length ? "Nenhum livro encontrado." : "A estante está vazia.") + '</strong>' +
        '<p>' + (books.length
          ? "Tente outro título, autor, género ou idioma."
          : "Os livros publicados aparecerão aqui quando forem adicionados.") + '</p>' +
        (books.length
          ? '<button class="book-button soft" id="clear-filters" type="button" style="margin-top:15px">Limpar filtros</button>'
          : "") +
        '</div>';

      const clear = document.getElementById("clear-filters");
      if (clear) {
        clear.addEventListener("click", function () {
          search.value = "";
          genre.value = "";
          language.value = "";
          sort.value = "featured";
          render();
        });
      }
      return;
    }

    grid.innerHTML = filtered.map(card).join("");
    bindWishlist();
  }

  form.addEventListener("input", render);
  form.addEventListener("change", render);

  fetch("/api/books", { headers: { Accept: "application/json" } })
    .then(async function (response) {
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; }
      catch (_) { throw new Error("Resposta inválida do catálogo."); }
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar a loja.");
      return data;
    })
    .then(function (data) {
      books = data.books || [];
      fill(genre, unique("genre"));
      fill(language, unique("language"));
      if (initialGenre) {
        const found = unique("genre").find(function (value) {
          return value.toLowerCase() === initialGenre.toLowerCase();
        });
        if (found) genre.value = found;
      }
      render();
    })
    .catch(function (error) {
      count.textContent = "Catálogo indisponível";
      grid.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1">' +
        '<div class="empty-icon">!</div>' +
        '<strong>Não foi possível carregar a loja.</strong>' +
        '<p>' + escapeHtml(error.message) + '</p>' +
        '</div>';
    });
})();