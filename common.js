async function injectPartial(targetId, url) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) return;

  el.innerHTML = await res.text();
}

function setActiveNav() {
  const page =
    document.body.getAttribute("data-page") ||
    location.pathname.split("/").pop().replace(".html", "") ||
    "index";

  const links = document.querySelectorAll(".nav__link[data-nav]");
  links.forEach(a => a.classList.remove("nav__link--active"));

  const active = document.querySelector(`.nav__link[data-nav="${page}"]`);
  if (active) active.classList.add("nav__link--active");
}

function setYear() {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
}

(async function boot() {
  await injectPartial("site-header", "header.html");
  await injectPartial("site-footer", "footer.html");
  setActiveNav();
  setYear();
})();
