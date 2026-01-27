(() => {
  const root = document.querySelector("[data-os]");
  if (!root) return;

  const accent = root.getAttribute("data-accent");
  if (accent) document.documentElement.style.setProperty("--pf-accent", accent);

  const $ = (sel, r=document) => r.querySelector(sel);
  const $$ = (sel, r=document) => Array.from(r.querySelectorAll(sel));

  const layer = $("[data-windowlayer]");
  const tasksEl = $("[data-tasks]");
  const startBtn = $("[data-start]");
  const startMenu = $("[data-startmenu]");
  const clockEl = $("[data-clock]");
  const cartBadge = $("[data-cartbadge]");

  // ---- Utilities
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  const isInternal = (url) => {
    try {
      const u = new URL(url, window.location.origin);
      return u.origin === window.location.origin;
    } catch { return false; }
  };

  const normalizeTitle = (t) => (t || "Window").trim().slice(0, 80);

  // Routes and hosts that should never be opened inside OS windows.  
  // Shopify's protected pages (account, orders, checkout and cart) trigger
  // content-security-policy frame-ancestor restrictions when embedded.  
  // Additionally, any cross‑origin URL (host not matching the current store)
  // is considered protected because it will either fail CORS fetch or be
  // blocked from being framed.  
  const protectedRoutes = [
    "/account",
    "/orders",
    "/checkout",
    "/cart/checkout",
    "/cart"
  ];

  /**
   * Returns true if the given URL should not be loaded inside an OS window.
   * Protected pages include Shopify account/checkout routes and any URL
   * whose host differs from the current window's host.  If the URL is
   * external (different origin) then it is opened in the top‑level window.
   */
  const isProtected = (url) => {
    try {
      const u = new URL(url, window.location.origin);
      // Block cross‑origin destinations (e.g. shop.app, accounts.shopify.com)
      if (u.host !== window.location.host) return true;
      // Block specific paths on the same origin
      return protectedRoutes.some((p) => u.pathname.startsWith(p));
    } catch {
      return false;
    }
  };

  // ---- Clock
  const tick = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    clockEl && (clockEl.textContent = `${hh}:${mm}`);
  };
  tick(); setInterval(tick, 10_000);

  // ---- Start menu (Windows 7 cascading)
  function closeStart() { startMenu?.setAttribute("hidden",""); }
  function openStart() { startMenu?.removeAttribute("hidden"); }
  startBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!startMenu) return;
    const hidden = startMenu.hasAttribute("hidden");
    hidden ? openStart() : closeStart();
  });

  // flyout hover logic
  $$(".pf-menu__item--hasflyout", startMenu || document).forEach(item => {
    const btn = $("[data-flyoutbtn]", item);
    const flyout = $("[data-flyout]", item);
    if (!btn || !flyout) return;

    const show = () => { flyout.removeAttribute("hidden"); };
    const hide = () => { flyout.setAttribute("hidden",""); closeDescendantFlyouts(flyout); };

    item.addEventListener("mouseenter", show);
    item.addEventListener("mouseleave", hide);
    btn.addEventListener("focus", show);
  });

  function closeDescendantFlyouts(node){
    $$("[data-flyout]", node).forEach(f => f.setAttribute("hidden",""));
  }

  // Close start when clicking outside
  document.addEventListener("mousedown", (e) => {
    if (!startMenu || startMenu.hasAttribute("hidden")) return;
    if (startMenu.contains(e.target) || startBtn === e.target || startBtn?.contains(e.target)) return;
    closeStart();
  });

  // ---- OS core: windows + taskbar
  let z = 2001;
  let seq = 0;
  const windows = new Map(); // id -> {el, taskEl, minimized, url, title}

  function setActive(winId){
    windows.forEach((w, id) => {
      w.el.style.zIndex = String(id === winId ? ++z : w.el.style.zIndex);
      w.taskEl?.setAttribute("aria-selected", id === winId ? "true" : "false");
      w.el.classList.toggle("pf-win--active", id === winId);
    });
  }

  function addTaskButton(winId, title){
    const li = document.createElement("li");
    li.className = "pf-task";
    li.setAttribute("role","button");
    li.setAttribute("tabindex","0");
    li.setAttribute("aria-selected","true");
    li.innerHTML = `<span class="pf-task__title">${escapeHtml(title)}</span><span class="pf-task__min">—</span>`;
    li.addEventListener("click", () => toggleMinimize(winId));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") toggleMinimize(winId); });
    tasksEl?.appendChild(li);
    return li;
  }

  function toggleMinimize(winId){
    const w = windows.get(winId);
    if (!w) return;
    if (w.minimized) {
      w.minimized = false;
      w.el.removeAttribute("aria-hidden");
      setActive(winId);
    } else {
      w.minimized = true;
      w.el.setAttribute("aria-hidden","true");
      w.taskEl?.setAttribute("aria-selected","false");
    }
  }

  function closeWindow(winId){
    const w = windows.get(winId);
    if (!w) return;
    w.el.remove();
    w.taskEl?.remove();
    windows.delete(winId);
    // activate last
    const last = Array.from(windows.keys()).pop();
    if (last) setActive(last);
  }

  function createWindow({ title, url, html, appId }){
    const winId = `w${Date.now()}_${++seq}`;
    const el = document.createElement("div");
    el.className = "pf-win";
    el.dataset.winid = winId;
    el.dataset.appid = appId || "";
    el.style.zIndex = String(++z);

    const safeTitle = normalizeTitle(title);

    el.innerHTML = `
      <div class="pf-win__bar" data-dragbar>
        <div class="pf-win__title">${escapeHtml(safeTitle)}</div>
        <div class="pf-win__controls">
          <button class="pf-win__ctrl" type="button" data-min aria-label="Minimize" title="Minimize">—</button>
          <button class="pf-win__ctrl pf-win__ctrl--close" type="button" data-close aria-label="Close" title="Close">✕</button>
        </div>
      </div>
      <div class="pf-win__body" data-body>${html || `<div class="pf-windesc">Loading…</div>`}</div>
    `;

    // position stagger
    const left = 46 + (seq % 7) * 18;
    const top  = 52 + (seq % 7) * 16;
    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;

    layer.appendChild(el);

    const taskEl = addTaskButton(winId, safeTitle);
    const w = { el, taskEl, minimized:false, url:url || null, title:safeTitle, appId:appId || null };
    windows.set(winId, w);
    setActive(winId);

    el.addEventListener("mousedown", () => setActive(winId));
    el.querySelector("[data-min]")?.addEventListener("click", () => toggleMinimize(winId));
    el.querySelector("[data-close]")?.addEventListener("click", () => closeWindow(winId));

    // drag
    const bar = el.querySelector("[data-dragbar]");
    let dragging = false, sx=0, sy=0, sl=0, st=0;

    bar?.addEventListener("mousedown", (e) => {
      dragging = true;
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      sl = r.left; st = r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      el.style.left = `${Math.max(6, sl + dx)}px`;
      el.style.top  = `${Math.max(6, st + dy)}px`;
    });
    window.addEventListener("mouseup", () => dragging = false);

    if (url) loadUrlIntoWindow(winId, url, safeTitle);
    return winId;
  }

  async function loadUrlIntoWindow(winId, url, fallbackTitle){
    const w = windows.get(winId);
    if (!w) return;
    const body = $("[data-body]", w.el);
    try {
      const u = new URL(url, window.location.origin);
      // Use ?view=window for internal routes
      if (u.origin === window.location.origin) {
        if (!u.searchParams.get("view")) u.searchParams.set("view","window");
      }
      const res = await fetch(u.toString(), { credentials:"same-origin" });
      const html = await res.text();
      body.innerHTML = html;

      // bind open-url buttons inside loaded content
      bindWindowInternalActions(body);

      // AJAX add-to-cart from product window
      bindProductAddToCart(body);

      // cart mount window
      const cartMount = body.querySelector("[data-cartmount]");
      if (cartMount) mountCart(cartMount);

      // search form predictive binding
      const searchForm = body.querySelector("[data-searchform]");
      if (searchForm) bindSearchWindow(searchForm, body);

    } catch (err){
      body.innerHTML = `<div class="pf-windesc">Couldn’t load content.</div>`;
    }
  }

  function bindWindowInternalActions(scope){
    // buttons with data-open-url
    scope.querySelectorAll("[data-open-url]").forEach(btn => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-open-url");
        if (url && isProtected(url)) { window.location.href = url; return; }
        const title = btn.getAttribute("data-title") || "Window";
        openUrl(url, title);
      });
    });

    // buttons that open app
    scope.querySelectorAll("[data-openapp]").forEach(btn => {
      btn.addEventListener("click", () => {
        const app = btn.getAttribute("data-openapp");
        launchApp(app);
      });
    });

    // normal internal links -> open in window
    scope.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (!isInternal(href)) return;
      if (isProtected(href)) return;
    if (isProtected(href)) return;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openUrl(href, a.textContent?.trim() || "Link");
      });
    });
  }

  // Global link interception (entire store as OS)
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (!isInternal(href)) return;

    // allow admin preview links etc
    if (a.hasAttribute("data-no-os")) return;

    e.preventDefault();
    const title = a.textContent?.trim() || "Window";
    openUrl(href, title);
    closeStart();
  });

  // Desktop icon activation
  function activateIcon(el){
    const osapp = el.getAttribute("data-osapp");
    const url = el.getAttribute("data-url");
    const title = el.getAttribute("data-title") || el.querySelector(".pf-iconlabel")?.textContent || "Window";
    if (osapp) return launchApp(osapp);
    if (url) return openUrl(url, title);
  }

  let lastClick = 0;
  root.querySelectorAll(".pf-icon").forEach(icon => {
    icon.addEventListener("click", () => {
      const now = Date.now();
      const dbl = now - lastClick < 340;
      lastClick = now;
      if (dbl) activateIcon(icon);
    });
    icon.addEventListener("keydown", (e) => {
      if (e.key === "Enter") activateIcon(icon);
    });
  });

  // Start menu command buttons
  startMenu?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-url],[data-osapp]");
    if (!btn) return;
    const osapp = btn.getAttribute("data-osapp");
    const url = btn.getAttribute("data-url");
    const title = btn.getAttribute("data-title") || btn.textContent?.trim() || "Window";
    closeStart();
    if (osapp) return launchApp(osapp, url, title);
    if (url) return openUrl(url, title);
  });

  // Make cascading flyouts open on focus/hover for second/third levels too
  startMenu?.querySelectorAll("[data-menuitem]").forEach(item => {
    const btn = item.querySelector("[data-flyoutbtn]");
    const flyout = item.querySelector(":scope > [data-flyout]");
    if (!btn || !flyout) return;
    const show = () => flyout.removeAttribute("hidden");
    const hide = () => { flyout.setAttribute("hidden",""); closeDescendantFlyouts(flyout); };
    item.addEventListener("mouseenter", show);
    item.addEventListener("mouseleave", hide);
    btn.addEventListener("focus", show);
  });

  // ---- App Registry
  const OS = {
    apps: new Map(),
    registerApp(id, def){ this.apps.set(id, def); },
    launch(id, ctx={}) {
      const def = this.apps.get(id);
      if (!def) return openUrl(ctx.url || "/", ctx.title || id);
      return def.launch(ctx);
    }
  };

  function launchApp(id, url, title){
    // allow /?osapp=cart style links too
    return OS.launch(id, { url, title });
  }

  function openUrl(url, title){
    if (isProtected(url)) { window.location.href = url; return; }
    createWindow({ title: title || "Window", url, appId:"url" });
  }

  // Special: parse osapp query (so nav can point to /?osapp=cart)
  (function(){
    const sp = new URLSearchParams(window.location.search);
    const osapp = sp.get("osapp");
    const open = sp.get("open");
    if (open) {
      const decoded = decodeURIComponent(open);
      openUrl(decoded, "Window");
      window.history.replaceState({}, "", "/");
      return;
    }
    if (osapp) {
      launchApp(osapp);
      window.history.replaceState({}, "", "/");
      return;
    }
    // If user lands on non-root path (direct visit), open that content in a window and reset to /
    if (window.location.pathname !== "/" && window.location.pathname !== "/index") {
      const here = window.location.pathname + window.location.search + window.location.hash;
      // Don't window-wrap protected routes (account/checkout/etc.)
      if (isProtected(here)) return;
      window.history.replaceState({}, "", "/");
      openUrl(here, document.title || "Window");
    }
  })();

  // ---- Apps

  OS.registerApp("cart", {
    launch(){
      return createWindow({ title:"Cart", url:"/cart", appId:"cart" });
    }
  });

  OS.registerApp("search", {
    launch(){
      return createWindow({ title:"Search", url:"/search", appId:"search" });
    }
  });

  OS.registerApp("collections", {
    launch(){
      return createWindow({ title:"Collections", url:"/collections", appId:"collections" });
    }
  });

  OS.registerApp("storefront", {
    launch(ctx){
      return createWindow({ title: ctx.title || "Storefront", url: ctx.url || "/collections/all", appId:"storefront" });
    }
  });

  // The Support app points to the contact page.  The legacy /pages/support
  // URL is deprecated on some shops; using /pages/contact ensures a page
  // always exists.  The optional ctx.url can override this default.
  OS.registerApp("support", {
    launch(ctx){
      return createWindow({ title: ctx.title || "Support", url: ctx.url || "/pages/contact", appId:"support" });
    }
  });

  OS.registerApp("system", {
    launch(ctx){
      return createWindow({ title: ctx.title || "Account", url: ctx.url || "/account", appId:"system" });
    }
  });

  OS.registerApp("studio", {
    launch(ctx){
      const productUrl = ctx?.url || "";
      const productTitle = ctx?.title || ctx?.productTitle || "Studio";
      const html = `
        <div class="pf-wincontent">
          <h2 class="pf-wintitle">Studio</h2>
          <div class="pf-windesc">Quick tools for digital products. (v2.2.2)</div>

          ${productUrl ? `<div class="pf-windesc" style="margin-top:8px;">Working on: <strong>${escapeHtml(productTitle)}</strong></div>` : ``}

          <div class="pf-tabs" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <button class="pf-winbtn pf-winbtn--ghost" type="button" data-tab="text">Text → SVG</button>
            <button class="pf-winbtn pf-winbtn--ghost" type="button" data-tab="svg">SVG Preview</button>
            <button class="pf-winbtn pf-winbtn--ghost" type="button" data-tab="notes">Notes</button>
            ${productUrl ? `<button class="pf-winbtn" type="button" data-open-url="${productUrl}" data-title="${escapeHtml(productTitle)}">Open Product</button>` : ``}
          </div>

          <div data-panel="text" style="margin-top:12px;">
            <div class="pf-windesc">Generate a simple SVG with custom text (great for quick previews).</div>
            <div class="pf-winrow" style="gap:10px;align-items:flex-end;">
              <div style="flex:1;min-width:180px;">
                <label class="pf-winlabel">Text</label>
                <input class="pf-wininput" type="text" value="${productUrl ? escapeHtml(productTitle) : "PHIA'S FAB"}" data-text>
              </div>
              <div style="width:120px;">
                <label class="pf-winlabel">Size</label>
                <input class="pf-wininput" type="number" value="72" min="10" max="200" data-size>
              </div>
              <button class="pf-winbtn" type="button" data-generate>Generate</button>
              <button class="pf-winbtn pf-winbtn--ghost" type="button" data-download disabled>Download SVG</button>
            </div>
            <div style="margin-top:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:10px;background:rgba(255,255,255,.04);">
              <div class="pf-windesc" style="margin-bottom:6px;">Preview</div>
              <div data-preview style="overflow:auto;max-height:280px;"></div>
            </div>
          </div>

          <div data-panel="svg" hidden style="margin-top:12px;">
            <div class="pf-windesc">Paste SVG markup to preview it.</div>
            <textarea class="pf-wininput" style="height:160px;white-space:pre;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;" data-svginput></textarea>
            <div class="pf-winrow" style="margin-top:8px;">
              <button class="pf-winbtn" type="button" data-render>Render</button>
              <button class="pf-winbtn pf-winbtn--ghost" type="button" data-clearsvg>Clear</button>
            </div>
            <div style="margin-top:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:10px;background:rgba(255,255,255,.04);">
              <div class="pf-windesc" style="margin-bottom:6px;">Preview</div>
              <div data-svgpreview style="overflow:auto;max-height:280px;"></div>
            </div>
          </div>

          <div data-panel="notes" hidden style="margin-top:12px;">
            <div class="pf-windesc">Scratchpad (stored only in this browser).</div>
            <textarea class="pf-wininput" style="height:180px;" data-notes placeholder="Notes…"></textarea>
          </div>
        </div>`;
      const winId = createWindow({ title: productUrl ? `Studio — ${productTitle}` : "Studio", html, appId:"studio" });

      const w = windows.get(winId);
      const body = w?.el?.querySelector("[data-body]");
      if (!body) return winId;

      bindWindowInternalActions(body);

      const panels = {
        text: body.querySelector('[data-panel="text"]'),
        svg: body.querySelector('[data-panel="svg"]'),
        notes: body.querySelector('[data-panel="notes"]')
      };
      const setTab = (name) => {
        Object.entries(panels).forEach(([k, el]) => {
          if (!el) return;
          if (k === name) el.removeAttribute("hidden");
          else el.setAttribute("hidden","");
        });
      };
      body.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.getAttribute("data-tab"))));

      // Notes persistence
      const notes = body.querySelector("[data-notes]");
      const notesKey = "pf_studio_notes";
      if (notes){
        notes.value = localStorage.getItem(notesKey) || "";
        notes.addEventListener("input", () => localStorage.setItem(notesKey, notes.value));
      }

      // Text -> SVG generator
      const tIn = body.querySelector("[data-text]");
      const sIn = body.querySelector("[data-size]");
      const genBtn = body.querySelector("[data-generate]");
      const dlBtn = body.querySelector("[data-download]");
      const prev = body.querySelector("[data-preview]");
      let lastSvg = "";

      const makeSvg = (text, size) => {
        const safe = escapeHtml(text);
        const fontSize = Math.max(10, Math.min(200, Number(size) || 72));
        const w = Math.max(600, safe.length * fontSize * 0.75);
        const h = Math.max(200, fontSize * 2.2);
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="transparent"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"
        font-family="Segoe UI, system-ui, sans-serif" font-size="${fontSize}"
        fill="white">${safe}</text>
</svg>`;
      };

      const renderSvg = (svg) => {
        lastSvg = svg;
        if (prev) prev.innerHTML = svg;
        if (dlBtn){ dlBtn.disabled = false; }
      };

      genBtn?.addEventListener("click", () => {
        const svg = makeSvg(tIn?.value || "PHIA'S FAB", sIn?.value || 72);
        renderSvg(svg);
      });

      dlBtn?.addEventListener("click", () => {
        if (!lastSvg) return;
        const blob = new Blob([lastSvg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "phiasfab-studio.svg";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });

      // SVG preview panel
      const svgIn = body.querySelector("[data-svginput]");
      const svgPrev = body.querySelector("[data-svgpreview]");
      body.querySelector("[data-render]")?.addEventListener("click", () => {
        const svg = svgIn?.value || "";
        if (svgPrev) svgPrev.innerHTML = svg;
      });
      body.querySelector("[data-clearsvg]")?.addEventListener("click", () => {
        if (svgIn) svgIn.value = "";
        if (svgPrev) svgPrev.innerHTML = "";
      });

      // initial render
      const initSvg = makeSvg(tIn?.value || "PHIA'S FAB", sIn?.value || 72);
      renderSvg(initSvg);

      return winId;
    }
  });

OS.registerApp("tools", {
    launch(){
      const html = `
        <div class="pf-wincontent">
          <h2 class="pf-wintitle">Tools</h2>
          <div class="pf-windesc">Utilities for files & workflow (converter, validator, compressor).</div>
          <div class="pf-grid" style="margin-top:12px;">
            <button class="pf-card" type="button" data-tool="compress"><div class="pf-card__meta"><div class="pf-card__title">Image Compressor</div><div class="pf-card__price">Coming next</div></div></button>
            <button class="pf-card" type="button" data-tool="convert"><div class="pf-card__meta"><div class="pf-card__title">File Converter</div><div class="pf-card__price">Coming next</div></div></button>
            <button class="pf-card" type="button" data-tool="validate"><div class="pf-card__meta"><div class="pf-card__title">Format Validator</div><div class="pf-card__price">Coming next</div></div></button>
          </div>
        </div>`;
      const winId = createWindow({ title:"Tools", html, appId:"tools" });
      return winId;
    }
  });

  OS.registerApp("vault", {
    launch(){
      // Shopify doesn't expose owned digital entitlements on storefront without an app/back-end.
      // So Vault is a customer-centric hub that points to orders + downloads.
      const html = `
        <div class="pf-wincontent">
          <h2 class="pf-wintitle">My Vault</h2>
          <div class="pf-windesc">Your purchased downloads live inside your account/orders. If you use a download app, links appear in order details.</div>
          <div class="pf-winrow">
            <button class="pf-winbtn" type="button" data-open-url="/account" data-title="Account">Open Account</button>
            <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open-url="/account/orders" data-title="Orders">Open Orders</button>
          </div>
          <div class="pf-windesc" style="margin-top:10px;">Next build: Vault UI that lists recent orders + download links (requires customer login + compatible download delivery).</div>
        </div>`;
      const winId = createWindow({ title:"My Vault", html, appId:"vault" });
      bindWindowInternalActions(windows.get(winId).el.querySelector("[data-body]"));
      return winId;
    }
  });

  // ---- Cart + badge
  async function refreshCartBadge(){
    try{
      const res = await fetch("/cart.js", { credentials:"same-origin" });
      const data = await res.json();
      if (cartBadge) cartBadge.textContent = String(data.item_count || 0);
    } catch {}
  }
  refreshCartBadge();
  setInterval(refreshCartBadge, 20_000);

  async function mountCart(mountEl){
    async function render(){
      mountEl.innerHTML = `<div class="pf-windesc">Loading…</div>`;
      const res = await fetch("/cart.js", { credentials:"same-origin" });
      const cart = await res.json();
      if (!cart.items || cart.items.length === 0){
        mountEl.innerHTML = `
          <div class="pf-windesc">Your cart is empty.</div>
          <div class="pf-winrow"><button class="pf-winbtn" type="button" data-open-url="/collections/all" data-title="Storefront">Browse Storefront</button></div>`;
        bindWindowInternalActions(mountEl);
        return;
      }

      const rows = cart.items.map(item => {
        const title = escapeHtml(item.product_title || item.title || "Item");
        const line = item.key;
        const qty = item.quantity;
        const price = (item.final_line_price / 100).toFixed(2);
        const img = item.image ? `<img src="${item.image}" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:12px;">` : `<div style="width:52px;height:52px;border-radius:12px;background:rgba(255,255,255,.06)"></div>`;
        return `
          <div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);">
            ${img}
            <div style="flex:1; min-width:0;">
              <div style="font-weight:650;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
              <div style="color:rgba(255,255,255,.68);font-size:12px;">$${price}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <button class="pf-winbtn pf-winbtn--ghost" type="button" data-qtyminus="${line}">−</button>
              <div style="min-width:22px;text-align:center;">${qty}</div>
              <button class="pf-winbtn pf-winbtn--ghost" type="button" data-qtyplus="${line}">+</button>
              <button class="pf-winbtn pf-winbtn--ghost" type="button" data-remove="${line}">Remove</button>
            </div>
          </div>
        `;
      }).join("");

      const subtotal = (cart.total_price / 100).toFixed(2);

      mountEl.innerHTML = `
        <div>${rows}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
          <div style="font-weight:700;">Subtotal</div>
          <div style="font-weight:700;">$${subtotal}</div>
        </div>
        <div class="pf-winrow" style="justify-content:flex-end;">
          <a class="pf-winbtn" href="/checkout" data-no-os>Checkout</a>
        </div>
      `;

      mountEl.querySelectorAll("[data-qtyminus]").forEach(b => b.addEventListener("click", () => changeQty(b.dataset.qtyminus, -1)));
      mountEl.querySelectorAll("[data-qtyplus]").forEach(b => b.addEventListener("click", () => changeQty(b.dataset.qtyplus, +1)));
      mountEl.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => setQty(b.dataset.remove, 0)));
    }

    async function changeQty(lineKey, delta){
      const res = await fetch("/cart.js", { credentials:"same-origin" });
      const cart = await res.json();
      const item = cart.items.find(i => i.key === lineKey);
      const next = Math.max(0, (item?.quantity || 0) + delta);
      await setQty(lineKey, next);
    }

    async function setQty(lineKey, quantity){
      await fetch("/cart/change.js", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        credentials:"same-origin",
        body: JSON.stringify({ id: lineKey, quantity })
      });
      await refreshCartBadge();
      await render();
    }

    await render();
  }

  // Product window AJAX add-to-cart
  function bindProductAddToCart(scope){
    const form = scope.querySelector('form[action^="/cart/add"]');
    const btn = scope.querySelector("[data-addtocart]");
    if (!form || !btn) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = "Adding…";
      const fd = new FormData(form);
      const payload = {
        id: fd.get("id"),
        quantity: Number(fd.get("quantity") || 1)
      };
      try{
        const res = await fetch("/cart/add.js", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          credentials:"same-origin",
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("add failed");
        await refreshCartBadge();
        btn.textContent = "Added ✓";
        setTimeout(() => { btn.textContent = "Add to cart"; btn.disabled = false; }, 900);
      } catch {
        btn.textContent = "Error";
        setTimeout(() => { btn.textContent = "Add to cart"; btn.disabled = false; }, 1000);
      }
    });
  }

  // Predictive search inside search window
  function bindSearchWindow(form, scope){
    const input = scope.querySelector("[data-searchinput]");
    if (!input) return;

    let t = null;
    let last = "";
    const resultsId = "pf-predictive";
    let results = scope.querySelector("#"+resultsId);
    if (!results){
      results = document.createElement("div");
      results.id = resultsId;
      results.style.marginTop = "12px";
      scope.appendChild(results);
    }

    const render = (items=[]) => {
      if (!items.length){
        results.innerHTML = `<div class="pf-windesc">Type to search products…</div>`;
        return;
      }
      results.innerHTML = `
        <div class="pf-grid">
          ${items.map(p => `
            <button class="pf-card" type="button" data-open-url="${p.url}" data-title="${escapeHtml(p.title)}">
              ${p.image ? `<img src="${p.image}" alt="">` : ``}
              <div class="pf-card__meta">
                <div class="pf-card__title">${escapeHtml(p.title)}</div>
                <div class="pf-card__price">${p.price || ""}</div>
              </div>
            </button>
          `).join("")}
        </div>
      `;
      bindWindowInternalActions(results);
    };

    async function fetchSuggest(q){
      const u = new URL("/search/suggest.json", window.location.origin);
      u.searchParams.set("q", q);
      u.searchParams.set("resources[type]", "product");
      u.searchParams.set("resources[limit]", "12");
      u.searchParams.set("resources[options][unavailable_products]", "last");
      const res = await fetch(u.toString(), { credentials:"same-origin" });
      const data = await res.json();
      const products = data?.resources?.results?.products || [];
      return products.map(p => ({
        title: p.title,
        url: p.url,
        image: p.featured_image?.url || "",
        price: ""
      }));
    }

    const onInput = () => {
      const q = input.value.trim();
      if (q === last) return;
      last = q;
      if (t) clearTimeout(t);
      if (q.length < 2){ render([]); return; }
      t = setTimeout(async () => {
        try{
          const items = await fetchSuggest(q);
          render(items);
        } catch {
          results.innerHTML = `<div class="pf-windesc">Search failed.</div>`;
        }
      }, 160);
    };

    input.addEventListener("input", onInput);
    render([]);
  }

  // Taskbar quick app buttons
  root.querySelectorAll("[data-osapp]").forEach(btn => {
    // avoid double-binding start menu buttons handled above
    if (btn.closest(".pf-startmenu")) return;
    btn.addEventListener("click", () => {
      const app = btn.getAttribute("data-osapp");
      if (app) launchApp(app);
      closeStart();
    });
  });

})();
