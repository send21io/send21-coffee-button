// send21 coffee button: one <script> tag, a floating ☕ button and a popup.
//   <script src="https://coffee.example.com/widget.js" async></script>
// Optional: data-position="left", data-label="☕".
// Everything lives in a shadow root, so host CSS can't break it and it can't break the host.
(() => {
  const me = document.currentScript;
  if (!me || window.__send21Coffee) return;
  window.__send21Coffee = true;
  const origin = new URL(me.src).origin;
  const left = me.dataset.position === "left";
  const label = (me.dataset.label || "☕").slice(0, 4);

  const css = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.fab { position: fixed; bottom: 20px; ${left ? "left" : "right"}: 20px; z-index: 2147483000; width: 64px; height: 64px; border-radius: 50%;
  border: 0; background: #f7931a; color: #1b1c20; font-size: 30px; cursor: pointer; box-shadow: 0 10px 30px #0006, 0 0 0 4px #f7931a33;
  transition: transform .2s ease; }
.fab:hover { transform: scale(1.08) rotate(-8deg); }
.fab:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid #fef8ec; outline-offset: 2px; }
.pop { position: fixed; bottom: 96px; ${left ? "left" : "right"}: 20px; z-index: 2147483000; width: min(320px, calc(100vw - 40px));
  background: #1b1c20; color: #fef8ec; border: 1px solid #34353d; border-radius: 22px; padding: 18px; box-shadow: 0 24px 60px #000a;
  transform-origin: bottom ${left ? "left" : "right"}; animation: pop .18s ease-out; }
.pop[hidden] { display: none; }
@keyframes pop { from { transform: scale(.85); opacity: 0; } }
.top { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 34px; line-height: 1; }
.count { font-size: 13px; font-weight: 700; color: #a3a1a8; }
.x { background: none; border: 0; color: #a3a1a8; font-size: 20px; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; }
.hero { margin: 6px 0 12px; color: #f7931a; font-weight: 800; font-size: 14px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.tile { position: relative; }
.tile input { position: absolute; opacity: 0; inset: 0; }
.tile span { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 86px; border-radius: 16px;
  background: #25262c; border: 2px solid #34353d; font-size: 22px; cursor: pointer; }
.tile b { font-size: 16px; }
.tile small { font-size: 11px; font-weight: 700; color: #a3a1a8; min-height: 14px; }
.tile input:checked + span { border-color: #f7931a; background: #3a2a10; }
.tile input:focus-visible + span { outline: 3px solid #fef8ec; }
.msg { width: 100%; margin-top: 10px; background: #25262c; border: 1px solid #34353d; border-radius: 14px; padding: 12px; color: inherit; font-size: 15px; }
.go { width: 100%; min-height: 52px; margin-top: 10px; border: 0; border-radius: 16px; background: #f7931a; color: #1b1c20; font-weight: 800; font-size: 18px; cursor: pointer; }
.foot { margin: 10px 0 0; text-align: center; font-size: 12px; color: #a3a1a8; }
.foot a { color: #f7931a; text-decoration: none; font-weight: 700; }
@media (prefers-reduced-motion: reduce) { .fab, .pop { transition: none; animation: none; } }`;

  const host = document.createElement("div");
  host.setAttribute("data-send21-coffee", "");
  const root = host.attachShadow({ mode: "open" });
  // Constructable stylesheet where available, a <style> element otherwise.
  if ("adoptedStyleSheets" in root && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);
  }

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...kids);
    return n;
  };
  const nonce = () => {
    const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes, (b) => abc[b % 36]).join("");
  };

  const nonceInput = el("input", { type: "hidden", name: "nonce", value: nonce() });
  const count = el("span", { class: "count" });
  const tile = (n, cups, checked) => {
    const input = el("input", { type: "radio", name: "cups", value: String(n), "aria-label": `${n} coffee${n > 1 ? "s" : ""}` });
    if (checked) input.checked = true;
    return el("label", { class: "tile" }, input, el("span", {}, cups, el("b", {}, `×${n}`), el("small", { "data-n": String(n) })));
  };
  const form = el(
    "form",
    // A normal form post in a new tab: no cross-origin fetch, no cookies, works with any host.
    { method: "post", action: `${origin}/coffee`, target: "_blank", rel: "noopener", onsubmit: () => setTimeout(() => { nonceInput.value = nonce(); toggle(false); }, 0) },
    nonceInput,
    el("div", { class: "tiles" }, tile(1, "☕", false), tile(3, "☕☕", true), tile(5, "☕☕☕", false)),
    el("input", { class: "msg", name: "message", maxlength: "80", placeholder: "say hi 👋 (optional)", autocomplete: "off", "aria-label": "message" }),
    el("button", { class: "go", type: "submit" }, "⚡ pay"),
  );
  const pop = el(
    "div",
    { class: "pop", role: "dialog", "aria-label": "buy me a coffee", hidden: "" },
    el("div", { class: "top" }, el("span", { class: "title" }, "☕"), count, el("button", { class: "x", type: "button", "aria-label": "close", onclick: () => toggle(false) }, "✕")),
    el("p", { class: "hero" }, "⚡ Lightning first · crypto ok"),
    form,
    el("p", { class: "foot" }, el("a", { href: `${origin}/wall`, target: "_blank", rel: "noopener" }, "🎉 wall"), " · send21"),
  );
  const fab = el("button", { class: "fab", type: "button", "aria-label": "buy me a coffee", "aria-expanded": "false", onclick: () => toggle(pop.hidden) }, label);

  function toggle(open) {
    pop.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) {
      fetch(`${origin}/api/wall`).then((r) => r.json()).then((w) => {
        count.textContent = w.coffees ? `🎉 ${w.coffees} ☕` : "";
        for (const p of form.querySelectorAll("small[data-n]")) p.textContent = typeof w.prices?.[p.dataset.n] === "string" ? w.prices[p.dataset.n] : "";
      }).catch(() => undefined);
      form.querySelector("input:checked")?.focus();
    }
  }
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { toggle(false); fab.focus(); } });
  root.append(pop, fab);
  (document.body || document.documentElement).append(host);
  window.send21Coffee = { open: () => toggle(true), close: () => toggle(false) };
})();
