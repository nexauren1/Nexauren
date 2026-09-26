(() => {
  const data = window.NEXAUREN_TOOL_DATA || { categories: [], tools: [] };
  const state = { lang: localStorage.getItem("nexauren-tools-language") || "pt", query: "" };

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
  const text = (value) => value?.[state.lang] || value?.pt || value?.en || "";

  function setLanguage(lang) {
    state.lang = lang === "en" ? "en" : "pt";
    localStorage.setItem("nexauren-tools-language", state.lang);
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-lang-button]").forEach((button) => {
      button.classList.toggle("active", button.dataset.langButton === state.lang);
    });
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.dataset.i18n;
      const dict = {
        eyebrow: {pt:"NEXAUREN TOOLS",en:"NEXAUREN TOOLS"},
        heading: {pt:"Ferramentas que acompanham o seu trabalho.",en:"Tools that keep up with your work."},
        description: {pt:"Pequenos utilitários para escrever, calcular, organizar e criar. Rápidos no telemóvel, simples no computador e preparados para crescer.",en:"Small utilities for writing, calculating, organizing and creating. Fast on mobile, simple on desktop and built to grow."},
        searchLabel: {pt:"Pesquisar ferramentas ou categorias",en:"Search tools or categories"},
        categories: {pt:"Categorias",en:"Categories"},
        categoriesSub: {pt:"Escolha uma categoria para ver as ferramentas disponíveis.",en:"Choose a category to see the available tools."},
        tools: {pt:"Catálogo Nexauren",en:"Nexauren Catalog"},
        toolsSub: {pt:"Ferramentas publicadas e descobertas automaticamente pelo catálogo.",en:"Published tools discovered automatically by the catalog."},
        empty: {pt:"Nenhuma ferramenta encontrada.",en:"No tools found."},
        open: {pt:"Abrir ferramenta",en:"Open tool"},
        free: {pt:"FREE",en:"FREE"},
        footer: {pt:"Nexauren Tools · ferramentas rápidas no navegador.",en:"Nexauren Tools · fast browser utilities."}
      };
      if (dict[key]) node.textContent = dict[key][state.lang];
    });
    render();
  }

  function categoryFor(tool) {
    return data.categories.find((item) => item.id === tool.category);
  }

  function renderCategories() {
    const target = $("#category-grid");
    if (!target) return;
    target.innerHTML = data.categories.map((category, index) =>
      '<a class="category-card" href="/tool/' + encodeURIComponent(category.slug) + '/">' +
        '<div class="card-icon">' + esc(category.icon || "•") + '</div>' +
        '<span class="card-index">0' + (index + 1) + '</span>' +
        '<strong>' + esc(text(category.title)) + '</strong>' +
        '<p>' + esc(text(category.description)) + '</p>' +
      '</a>'
    ).join("") || '<div class="state">' + (state.lang === "pt" ? "Nenhuma categoria disponível." : "No category available.") + '</div>';
  }

  function renderTools() {
    const target = $("#tool-grid");
    if (!target) return;
    const query = state.query.trim().toLowerCase();
    const filtered = data.tools.filter((tool) => {
      if (tool.status !== "published") return false;
      const category = categoryFor(tool);
      const haystack = [
        text(tool.title), text(tool.description),
        tool.slug, tool.category, text(category?.title)
      ].join(" ").toLowerCase();
      return !query || haystack.includes(query);
    });
    target.innerHTML = filtered.map((tool) =>
      '<article class="tool-card">' +
        '<div class="tool-card-head"><div class="card-icon">' + esc(tool.icon || "TOOL") + '</div><span class="badge free">' + (state.lang === "pt" ? "FREE" : "FREE") + '</span></div>' +
        '<h3>' + esc(text(tool.title)) + '</h3>' +
        '<p>' + esc(text(tool.description)) + '</p>' +
        '<div class="tool-actions"><a class="tool-button" href="' + esc(tool.route) + '">' + (state.lang === "pt" ? "Abrir ferramenta" : "Open tool") + ' →</a></div>' +
      '</article>'
    ).join("") || '<div class="state">' + (state.lang === "pt" ? "Nenhuma ferramenta encontrada." : "No tools found.") + '</div>';
  }

  function render() {
    renderCategories();
    renderTools();
  }

  document.querySelectorAll("[data-lang-button]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.langButton));
  });
  const search = $("#tool-search");
  if (search) search.addEventListener("input", () => { state.query = search.value; renderTools(); });
  const toggle = $("#tool-menu-toggle");
  const nav = $("#tool-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded","false");
      nav.classList.remove("is-open");
    }));
  }
  setLanguage(state.lang);
})();