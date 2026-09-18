(() => {
  const host = document.getElementById("category-grid");
  if (!host) return;

  const categories = [
    ["Fiction", "Ficção", "Romances, dramas e narrativas."],
    ["Fantasy", "Fantasia", "Mundos, magia e imaginação."],
    ["Mystery", "Mistério", "Pistas, perguntas e descobertas."],
    ["Romance", "Romance", "Relações, encontros e emoções."],
    ["Science Fiction", "Ficção científica", "Ideias, futuro e possibilidade."],
    ["Poetry", "Poesia", "Palavras em ritmo e sentimento."],
    ["Personal Growth", "Desenvolvimento pessoal", "Conhecimento e crescimento."],
    ["Education", "Educação", "Guias, estudo e aprendizagem."]
  ];

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, function (char) {
      return {
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        "'": "&#039;", '"': "&quot;"
      }[char];
    });
  }

  function render(books) {
    host.innerHTML = categories.map(function (item, index) {
      const key = item[0];
      const label = item[1];
      const description = item[2];
      const total = books.filter(function (book) {
        return String(book.genre || "").toLowerCase() === key.toLowerCase();
      }).length;

      return (
        '<a class="category-card" href="/books/store/?genre=' + encodeURIComponent(key) + '">' +
          '<span class="category-no">' + String(index + 1).padStart(2, "0") + '</span>' +
          '<strong>' + escapeHtml(label) + '</strong>' +
          '<small>' + escapeHtml(description) + '</small>' +
          '<span class="category-count">' + total + " " + (total === 1 ? "livro publicado" : "livros publicados") + '</span>' +
        '</a>'
      );
    }).join("");
  }

  fetch("/api/books", { headers: { Accept: "application/json" } })
    .then(function (response) { return response.json(); })
    .then(function (data) { render(data.books || []); })
    .catch(function () { render([]); });
})();