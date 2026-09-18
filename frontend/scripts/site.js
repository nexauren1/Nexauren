(() => {
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  const toggle = document.querySelector(".books-menu-toggle");
  const nav = document.getElementById("books-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
      document.body.classList.toggle("menu-open", !open);
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
        document.body.classList.remove("menu-open");
      });
    });
  }

  const search = document.getElementById("global-search");
  if (search) {
    search.addEventListener("submit", function (event) {
      event.preventDefault();
      const input = search.querySelector("input");
      const query = input ? input.value.trim() : "";
      const url = new URL("/books/store/", location.origin);
      if (query) url.searchParams.set("q", query);
      location.href = url.toString();
    });
  }

  const accountLink = document.querySelector("[data-account-link]");
  if (accountLink) {
    fetch("/api/auth/me", { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (data && data.user) accountLink.textContent = "Minha conta";
      })
      .catch(function () {});
  }
})();