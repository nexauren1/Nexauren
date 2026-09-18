(() => {
  const slug = new URLSearchParams(location.search).get("slug");
  const title = document.getElementById("book-title");
  const lead = document.getElementById("book-lead");
  const price = document.getElementById("book-price");
  const note = document.getElementById("purchase-note");
  const actions = document.getElementById("purchase-actions");
  const cover = document.getElementById("book-cover");
  const meta = document.getElementById("book-meta");
  const description = document.getElementById("book-description");
  const author = document.getElementById("book-author");
  const formats = document.getElementById("book-formats");
  const preview = document.getElementById("book-preview");
  const related = document.getElementById("related");

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

  async function api(path, options) {
    const response = await fetch(path, Object.assign({
      credentials: "same-origin"
    }, options || {
      credentials: "same-origin"
    }));
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch (_) { throw new Error("Resposta inválida do servidor (" + response.status + ")."); }
    if (!response.ok) throw new Error(data.error || "Pedido não concluído.");
    return data;
  }

  function errorState(message) {
    const main = document.querySelector(".product");
    main.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1">' +
      '<div class="empty-icon">!</div><strong>Livro indisponível.</strong>' +
      '<p>' + escapeHtml(message) + '</p>' +
      '<a class="book-button soft" href="/books/store/" style="margin-top:15px">Voltar para a loja</a>' +
      '</div>';
  }

  function addLink(text, href, primary) {
    const link = document.createElement("a");
    link.className = "book-button " + (primary ? "primary" : "soft");
    link.href = href;
    link.textContent = text;
    actions.appendChild(link);
  }

  function loadPaypal(clientId) {
    return new Promise(function (resolve, reject) {
      if (window.paypal) return resolve(window.paypal);
      const script = document.createElement("script");
      script.src =
        "https://www.paypal.com/sdk/js?client-id=" +
        encodeURIComponent(clientId) +
        "&currency=USD&intent=capture";
      script.onload = function () { resolve(window.paypal); };
      script.onerror = function () {
        reject(new Error("Não foi possível carregar o PayPal Checkout."));
      };
      document.head.appendChild(script);
    });
  }

  function renderRelated(items, current) {
    const matches = items
      .filter(function (book) { return book.slug !== current.slug; })
      .filter(function (book) {
        return current.genre &&
          String(book.genre || "").toLowerCase() === String(current.genre).toLowerCase();
      })
      .slice(0, 3);

    if (!matches.length) return;

    related.innerHTML =
      '<div class="section-heading" style="margin-bottom:16px">' +
      '<div><p class="eyebrow">MAIS PARA DESCOBRIR</p><h2 style="font-size:32px">Da mesma estante.</h2></div>' +
      '</div>' +
      '<div class="book-grid" style="grid-template-columns:repeat(3,1fr)">' +
      matches.map(function (book) {
        const coverStyle = book.cover_url
          ? 'style="background-image:url(\'' + encodeURI(book.cover_url) + '\')"'
          : "";
        return (
          '<article class="book-card"><a href="/books/book/?slug=' + encodeURIComponent(book.slug) + '">' +
          '<div class="book-card-cover ' + (book.cover_url ? "" : "no-cover") + '" ' + coverStyle + '>' +
          (book.cover_url ? "" : "<span>NEXAUREN<br>STORY</span>") +
          '</div><div class="book-card-copy"><div class="book-meta">' +
          escapeHtml(book.genre || "Livro") + '</div><h3>' + escapeHtml(book.title) +
          '</h3><p>' + escapeHtml(book.author || "Nexauren Story") + '</p></div></a></article>'
        );
      }).join("") +
      '</div>';
  }

  async function renderBook(book, catalogue) {
    document.title = book.title + " — Nexauren Story";
    title.textContent = book.title;
    lead.textContent = book.description || book.premise || "Uma edição digital da Nexauren Story.";
    price.textContent = money(book.price_usd, book.currency);
    author.textContent = book.author || "Nexauren Story";
    description.textContent = book.description || book.premise || "Descrição editorial a publicar.";
    const availableFormats = [
      book.pdf_available ? "pdf" : null,
      book.epub_available ? "epub" : null
    ].filter(Boolean);
    formats.textContent = availableFormats.length
      ? availableFormats.map(function (item) { return item.toUpperCase(); }).join(" · ")
      : "Formato digital pendente";
    preview.textContent = book.preview_url ? "Prévia disponível." : "Prévia não adicionada.";
    meta.innerHTML = [book.genre, book.language, book.age_rating, book.audience]
      .filter(Boolean)
      .map(function (item) { return '<span class="meta">' + escapeHtml(item) + '</span>'; })
      .join("");

    if (book.cover_url) {
      cover.style.backgroundImage = 'url("' + encodeURI(book.cover_url).replace(/"/g, "%22") + '")';
      cover.innerHTML =
        '<div><small>' + escapeHtml(book.author || "NEXAUREN STORY") +
        '</small><strong>' + escapeHtml(book.title) + '</strong></div>';
    } else {
      cover.innerHTML =
        '<div><small>NEXAUREN STORY</small><strong>' +
        escapeHtml(book.title) + '</strong></div>';
    }

    actions.innerHTML = "";
    if (book.preview_url) addLink("Ver prévia ↗", book.preview_url, false);

    const account = await api("/api/account");
    const owned = Boolean(
      account.user &&
      (account.purchases || []).some(function (item) {
        return item.product_id === (book.product && book.product.id) &&
          item.status === "ACTIVE";
      })
    );

    if (!book.product || Number(book.price_usd || 0) <= 0) {
      note.textContent = owned
        ? "Edição adquirida. Os ficheiros digitais estão disponíveis."
        : "Esta edição é gratuita ou ainda não está configurada para venda.";
      if (account.user || !book.product) {
        availableFormats.forEach(function (format) {
          addLink(
            "Abrir " + format.toUpperCase(),
            "/api/books/" + encodeURIComponent(book.slug) +
            "/download?format=" + encodeURIComponent(format),
            false
          );
        });
      } else {
        addLink("Entrar para abrir", "/account/", true);
      }
      renderRelated(catalogue, book);
      return;
    }

    if (owned) {
      note.textContent = "Compra confirmada. A sua edição está pronta.";
      availableFormats.forEach(function (format) {
        addLink(
          "Abrir " + format.toUpperCase(),
          "/api/books/" + encodeURIComponent(book.slug) +
          "/download?format=" + encodeURIComponent(format),
          false
        );
      });
      renderRelated(catalogue, book);
      return;
    }

    if (!account.user) {
      note.textContent = "Entre na sua conta para concluir a compra.";
      addLink("Entrar para comprar", "/account/", true);
      renderRelated(catalogue, book);
      return;
    }

    const config = await api("/api/paypal/config");
    if (!config.configured) {
      note.textContent = "O checkout aparece aqui assim que o PayPal estiver ligado ao Worker.";
      renderRelated(catalogue, book);
      return;
    }

    note.textContent = "Checkout seguro por PayPal. O pagamento é confirmado no servidor.";
    const host = document.createElement("div");
    host.id = "paypal-button-container";
    host.style.width = "100%";
    host.style.marginTop = "12px";
    actions.appendChild(host);

    const paypal = await loadPaypal(config.client_id);
    paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "paypal" },
      async createOrder() {
        const data = await api("/api/paypal/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: book.product.id })
        });
        return data.id;
      },
      async onApprove(data) {
        note.textContent = "A confirmar o pagamento…";
        await api("/api/paypal/capture-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: data.orderID })
        });
        note.textContent = "Pagamento concluído. O livro foi adicionado à sua biblioteca.";
        actions.innerHTML = "";
        availableFormats.forEach(function (format) {
          addLink(
            "Abrir " + format.toUpperCase(),
            "/api/books/" + encodeURIComponent(book.slug) +
            "/download?format=" + encodeURIComponent(format),
            false
          );
        });
      },
      onCancel() { note.textContent = "Checkout cancelado."; },
      onError(error) {
        console.error(error);
        note.textContent = "O PayPal não conseguiu concluir este checkout.";
      }
    }).render("#paypal-button-container");

    renderRelated(catalogue, book);
  }

  if (!slug) {
    errorState("Nenhum livro foi selecionado.");
    return;
  }

  Promise.all([
    api("/api/books/" + encodeURIComponent(slug)),
    api("/api/books")
  ])
    .then(function (results) {
      return renderBook(results[0].book, results[1].books || []);
    })
    .catch(function (error) {
      errorState(error.message);
    });
})();