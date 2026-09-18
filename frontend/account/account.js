const guestView = document.getElementById("guest-view");
const userView = document.getElementById("user-view");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const logoutButton = document.getElementById("logout");

async function api(path, options) {
  const response = await fetch(path, Object.assign({
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  }, options || {}));

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch (_) { throw new Error("Resposta inválida do servidor (" + response.status + ")."); }

  if (!response.ok) throw new Error(data.error || "Pedido não concluído.");
  return data;
}

function showStatus(id, message) {
  const target = document.getElementById(id);
  if (target) target.textContent = message;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, function (char) {
    return {
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      "'": "&#039;", '"': "&quot;"
    }[char];
  });
}

function renderUser(data) {
  if (!data.user) {
    guestView.classList.remove("hidden");
    userView.classList.add("hidden");
    return;
  }

  guestView.classList.add("hidden");
  userView.classList.remove("hidden");
  document.getElementById("profile-name").textContent = data.user.name || "Leitor Nexauren";
  document.getElementById("profile-email").textContent = data.user.email || "";
  document.getElementById("profile-role").textContent = data.user.role || "user";

  const list = document.getElementById("purchases");
  const purchases = (data.purchases || []).filter(function (item) {
    return item.type === "book";
  });

  if (!purchases.length) {
    list.innerHTML =
      '<div class="purchase"><strong>Ainda não existem compras de livros.</strong>' +
      '<span>Explore a loja para encontrar a sua próxima leitura.</span></div>';
    return;
  }

  list.innerHTML = purchases.map(function (item) {
    return '<div class="purchase"><strong>' + escapeHtml(item.title) +
      '</strong><span>Livro · Compra registada na Nexauren Story</span></div>';
  }).join("");
}

loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  showStatus("login-status", "A entrar…");
  try {
    await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: loginForm.email.value,
        password: loginForm.password.value
      })
    });
    await loadAccount();
  } catch (error) {
    showStatus("login-status", error.message);
  }
});

registerForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  showStatus("register-status", "A criar a conta…");

  if (registerForm.password.value !== registerForm.confirm_password.value) {
    showStatus("register-status", "As palavras-passe não coincidem.");
    return;
  }

  try {
    await api("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: registerForm.name.value,
        email: registerForm.email.value,
        password: registerForm.password.value
      })
    });
    await loadAccount();
  } catch (error) {
    showStatus("register-status", error.message);
  }
});

logoutButton.addEventListener("click", async function () {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } finally {
    await loadAccount();
  }
});

async function loadAccount() {
  try {
    renderUser(await api("/api/account"));
  } catch (_) {
    renderUser({ user: null });
  }
}

loadAccount();