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
  const taskbarEl = root.querySelector(".pf-taskbar");

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

  // ---- Start menu
  function closeStart() { 
    startMenu?.setAttribute("hidden","");
    startBtn?.classList.remove("pf-startbtn--active");
  }
  function openStart() { 
    startMenu?.removeAttribute("hidden");
    startBtn?.classList.add("pf-startbtn--active");
  }
  startBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!startMenu) return;
    const hidden = startMenu.hasAttribute("hidden");
    hidden ? openStart() : closeStart();
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

  // Close start menu on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && startMenu && !startMenu.hasAttribute("hidden")) {
      closeStart();
    }
  });
  document.addEventListener("focusin", (e) => {
    if (!startMenu || startMenu.hasAttribute("hidden")) return;
    if (startMenu.contains(e.target) || startBtn?.contains(e.target)) return;
    closeStart();
  });
  window.addEventListener("blur", closeStart);

  // ---- OS core: windows + taskbar
  let z = 2001;
  let seq = 0;
  const windows = new Map(); // id -> {el, taskEl, minimized, maximized, url, title, restoreState}
  let dragState = null;

  const getTaskbarHeight = () => taskbarEl?.getBoundingClientRect().height || 48;

  window.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const state = dragState;
    const w = windows.get(state.winId);
    if (!w) return;
    if (state.wasMaximized) {
      state.wasMaximized = false;
      toggleMaximize(state.winId);
      const r = w.el.getBoundingClientRect();
      state.sl = r.left;
      state.st = r.top;
      state.sx = e.clientX;
      state.sy = e.clientY;
    }
    const r = w.el.getBoundingClientRect();
    const dx = e.clientX - state.sx;
    const dy = e.clientY - state.sy;
    const maxLeft = Math.max(6, window.innerWidth - r.width - 6);
    const maxTop = Math.max(6, window.innerHeight - getTaskbarHeight() - r.height - 6);
    w.el.style.left = `${Math.max(6, Math.min(state.sl + dx, maxLeft))}px`;
    w.el.style.top = `${Math.max(6, Math.min(state.st + dy, maxTop))}px`;
  });

  window.addEventListener("mouseup", () => {
    if (dragState) dragState = null;
  });

  function setActive(winId){
    const target = windows.get(winId);
    if (!target || target.minimized) return;
    windows.forEach((w, id) => {
      if (id === winId) {
        w.el.style.zIndex = String(++z);
        w.taskEl?.setAttribute("aria-selected", "true");
        w.el.classList.add("pf-win--active");
      } else {
        w.taskEl?.setAttribute("aria-selected", "false");
        w.el.classList.remove("pf-win--active");
      }
    });
  }

  function activateLastVisible(excludeId){
    const ids = Array.from(windows.keys());
    for (let i = ids.length - 1; i >= 0; i -= 1){
      const id = ids[i];
      const w = windows.get(id);
      if (!w || w.minimized || id === excludeId) continue;
      setActive(id);
      return;
    }
    windows.forEach((w) => w.taskEl?.setAttribute("aria-selected", "false"));
  }

  function addTaskButton(winId, title){
    const li = document.createElement("li");
    li.className = "pf-task";
    li.setAttribute("role","button");
    li.setAttribute("tabindex","0");
    li.setAttribute("aria-selected","true");
    li.innerHTML = `<span class="pf-task__title">${escapeHtml(title)}</span><span class="pf-task__min">—</span>`;
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      const w = windows.get(winId);
      if (!w) return;
      if (w.minimized) {
        restoreWindow(winId);
      } else if (w.el.classList.contains("pf-win--active")) {
        minimizeWindow(winId);
      } else {
        setActive(winId);
      }
    });
    li.addEventListener("keydown", (e) => { 
      if (e.key === "Enter") {
        const w = windows.get(winId);
        if (w?.minimized) restoreWindow(winId);
        else if (w?.el.classList.contains("pf-win--active")) minimizeWindow(winId);
        else setActive(winId);
      }
    });
    tasksEl?.appendChild(li);
    return li;
  }

  function minimizeWindow(winId){
    const w = windows.get(winId);
    if (!w || w.minimized) return;
    w.minimized = true;
    w.el.style.transition = "transform 0.2s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.2s ease";
    const rect = w.el.getBoundingClientRect();
    const taskRect = w.taskEl.getBoundingClientRect();
    const targetX = taskRect.left + taskRect.width / 2 - rect.width / 2;
    const targetY = taskRect.top - rect.height;
    const scaleX = taskRect.width / rect.width;
    const scaleY = 0.1;
    
    w.el.style.transformOrigin = "top center";
    w.el.style.transform = `translate(${targetX - rect.left}px, ${targetY - rect.top}px) scale(${scaleX}, ${scaleY})`;
    w.el.style.opacity = "0";
    
    setTimeout(() => {
      w.el.setAttribute("aria-hidden","true");
      w.el.style.transition = "";
      w.el.style.transform = "";
      w.el.style.opacity = "";
      w.el.style.transformOrigin = "";
      w.taskEl?.setAttribute("aria-selected","false");
      activateLastVisible(winId);
    }, 200);
  }

  function restoreWindow(winId){
    const w = windows.get(winId);
    if (!w || !w.minimized) return;
    w.minimized = false;
    w.el.removeAttribute("aria-hidden");
    w.el.style.transition = "transform 0.2s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.2s ease";
    w.el.style.opacity = "0";
    w.el.style.transform = "scale(0.95)";
    
    requestAnimationFrame(() => {
      w.el.style.opacity = "1";
      w.el.style.transform = "scale(1)";
      setTimeout(() => {
        w.el.style.transition = "";
        w.el.style.opacity = "";
        w.el.style.transform = "";
        setActive(winId);
      }, 200);
    });
  }

  function toggleMinimize(winId){
    const w = windows.get(winId);
    if (!w) return;
    if (w.minimized) {
      restoreWindow(winId);
    } else {
      minimizeWindow(winId);
    }
  }

  function toggleMaximize(winId){
    const w = windows.get(winId);
    if (!w) return;
    
    if (w.maximized) {
      // Restore
      w.maximized = false;
      w.el.classList.remove("pf-win--maximized");
      w.el.removeAttribute("data-max");
      const restore = w.restoreState;
      w.el.style.width = restore.width;
      w.el.style.height = restore.height;
      w.el.style.left = restore.left;
      w.el.style.top = restore.top;
      w.el.style.transition = "all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)";
      setTimeout(() => { w.el.style.transition = ""; }, 200);
    } else {
      // Maximize
      w.maximized = true;
      w.el.classList.add("pf-win--maximized");
      w.el.setAttribute("data-max","true");
      const rect = w.el.getBoundingClientRect();
      w.restoreState = {
        width: w.el.style.width || `${rect.width}px`,
        height: w.el.style.height || `${rect.height}px`,
        left: w.el.style.left || `${rect.left}px`,
        top: w.el.style.top || `${rect.top}px`
      };
      w.el.style.transition = "all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)";
      const taskbarHeight = getTaskbarHeight();
      w.el.style.width = "calc(100vw - 12px)";
      w.el.style.height = `calc(100vh - ${taskbarHeight + 12}px)`;
      w.el.style.left = "6px";
      w.el.style.top = "6px";
      setTimeout(() => { w.el.style.transition = ""; }, 200);
    }
    setActive(winId);
  }

  function closeWindow(winId){
    const w = windows.get(winId);
    if (!w) return;
    
    // Animate close
    w.el.style.transition = "opacity 0.15s ease, transform 0.15s ease";
    w.el.style.opacity = "0";
    w.el.style.transform = "scale(0.95)";
    
    setTimeout(() => {
      w.el.remove();
      w.taskEl?.remove();
      windows.delete(winId);
      activateLastVisible();
    }, 150);
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
                    <button class="pf-win__ctrl" type="button" data-max aria-label="Maximize" title="Maximize">▢</button>
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

    // Initial animation state
    el.style.opacity = "0";
    el.style.transform = "scale(0.95) translateY(-10px)";
    
    layer.appendChild(el);

    const taskEl = addTaskButton(winId, safeTitle);
    const w = { el, taskEl, minimized:false, maximized:false, url:url || null, title:safeTitle, appId:appId || null, restoreState:null };
    windows.set(winId, w);
    setActive(winId);

    // Animate window in
    requestAnimationFrame(() => {
      el.style.transition = "opacity 0.2s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)";
      el.style.opacity = "1";
      el.style.transform = "scale(1) translateY(0)";
      setTimeout(() => {
        el.style.transition = "";
      }, 200);
    });

    el.addEventListener("mousedown", () => setActive(winId));
    el.querySelector("[data-min]")?.addEventListener("click", (e) => { e.stopPropagation(); toggleMinimize(winId); });
    el.querySelector("[data-max]")?.addEventListener("click", (e) => { e.stopPropagation(); toggleMaximize(winId); });
    el.querySelector("[data-close]")?.addEventListener("click", (e) => { e.stopPropagation(); closeWindow(winId); });

    // drag
    const bar = el.querySelector("[data-dragbar]");
    bar?.addEventListener("mousedown", (e) => {
      if (e.target.closest(".pf-win__controls")) return;
      const r = el.getBoundingClientRect();
      dragState = {
        winId,
        sx: e.clientX,
        sy: e.clientY,
        sl: r.left,
        st: r.top,
        wasMaximized: windows.get(winId)?.maximized
      };
      e.preventDefault();
    });

    bar?.addEventListener("dblclick", (e) => {
      if (e.target.closest(".pf-win__controls")) return;
      toggleMaximize(winId);
    });

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
  let lastClickTarget = null;
  root.querySelectorAll(".pf-icon").forEach(icon => {
    icon.addEventListener("click", (e) => {
      const now = Date.now();
      const sameTarget = lastClickTarget === icon;
      const dbl = sameTarget && now - lastClick < 500;
      lastClick = now;
      lastClickTarget = icon;
      if (dbl) {
        activateIcon(icon);
        lastClickTarget = null;
      }
    });
    icon.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activateIcon(icon);
      }
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

  
  OS.registerApp("files", {
    launch(ctx){
      const html = `
        <div class="pf-wincontent">
          <h2 class="pf-wintitle">File Manager</h2>
          <div class="pf-windesc">Browse by file type, compatibility, and licenses. (Storefront-powered)</div>

          <div class="pf-winrow" style="gap:10px;flex-wrap:wrap;margin-top:12px;">
            <button class="pf-winbtn" type="button" data-open="/collections/all?filter.p.tag=file-svg" data-title="SVG Files">SVG</button>
            <button class="pf-winbtn" type="button" data-open="/collections/all?filter.p.tag=file-stl" data-title="STL Files">STL</button>
            <button class="pf-winbtn" type="button" data-open="/collections/all?filter.p.tag=file-pdf" data-title="PDF Files">PDF</button>
            <button class="pf-winbtn" type="button" data-open="/collections/all?filter.p.tag=file-bundle" data-title="Bundles">Bundles</button>
            <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all" data-title="All Files">All</button>
          </div>

          <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div style="border:1px solid #c3cbd9;border-radius:2px;padding:12px;background:#f5f7fb;">
              <div class="pf-windesc" style="margin-bottom:10px;">Compatibility</div>
              <div class="pf-winrow" style="gap:8px;flex-wrap:wrap;">
                <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all?filter.p.tag=compat-cricut" data-title="Cricut Compatible">Cricut</button>
                <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all?filter.p.tag=compat-silhouette" data-title="Silhouette Compatible">Silhouette</button>
                <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all?filter.p.tag=compat-3dprint" data-title="3D Print Ready">3D Print</button>
                <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all?filter.p.tag=compat-cnc" data-title="CNC Ready">CNC</button>
              </div>
            </div>

            <div style="border:1px solid #c3cbd9;border-radius:2px;padding:12px;background:#f5f7fb;">
              <div class="pf-windesc" style="margin-bottom:10px;">Licenses</div>
              <div class="pf-winrow" style="gap:8px;flex-wrap:wrap;">
                <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all?filter.p.tag=lic-personal" data-title="Personal License">Personal</button>
                <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all?filter.p.tag=lic-commercial" data-title="Commercial License">Commercial</button>
                <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/collections/all?filter.p.tag=lic-extended" data-title="Extended License">Extended</button>
              </div>
            </div>
          </div>

          <div style="margin-top:14px;">
            <div class="pf-windesc">Purchased downloads are typically shown in your order details. Use Account → Orders for exact download links.</div>
            <div class="pf-winrow" style="gap:10px;margin-top:10px;flex-wrap:wrap;">
              <button class="pf-winbtn" type="button" data-open="/account" data-title="Account">Open Account</button>
              <button class="pf-winbtn pf-winbtn--ghost" type="button" data-open="/account/orders" data-title="Orders">Open Orders</button>
            </div>
          </div>
        </div>
      `;
      const winId = createWindow({ title: ctx.title || "File Manager", html, appId:"files" });
      const win = windows.get(winId);
      if (!win) return winId;
      win.el.addEventListener("click", (e)=>{
        const btn = e.target.closest("[data-open]");
        if (!btn) return;
        openUrl(btn.getAttribute("data-open"), btn.getAttribute("data-title") || "Window");
      });
      return winId;
    }
  });

  OS.registerApp("settings", {
    launch(){
      const html = `
        <div class="pf-wincontent">
          <h2 class="pf-wintitle">Settings</h2>
          <div class="pf-windesc">Local OS preferences stored in your browser (does not change Shopify theme settings).</div>

          <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div style="border:1px solid #c3cbd9;border-radius:2px;padding:12px;background:#f5f7fb;">
              <label class="pf-winlabel">UI Scale</label>
              <input class="pf-wininput" type="range" min="90" max="120" value="100" data-ui-scale>
              <div class="pf-windesc" style="margin-top:6px;">Tip: 100% is default.</div>
            </div>
            <div style="border:1px solid #c3cbd9;border-radius:2px;padding:12px;background:#f5f7fb;">
              <label class="pf-winlabel">Reduce motion</label>
              <select class="pf-wininput" data-reduce-motion>
                <option value="system">System default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
              <div class="pf-windesc" style="margin-top:6px;">Overrides system preference for this site.</div>
            </div>
          </div>

          <div class="pf-winrow" style="gap:10px;flex-wrap:wrap;margin-top:14px;">
            <button class="pf-winbtn" type="button" data-reset>Reset to defaults</button>
          </div>
        </div>
      `;
      const w = createWindow({ title:"Settings", html, appId:"settings" });

      // apply + persist settings
      const key = "pf_os_settings_v1";
      const load = () => { try{ return JSON.parse(localStorage.getItem(key) || "{}"); }catch(e){ return {}; } };
      const save = (obj) => localStorage.setItem(key, JSON.stringify(obj));

      const state = Object.assign({ uiScale: 100, reduceMotion: "system" }, load());

      const scale = w.el.querySelector("[data-ui-scale]");
      const rm = w.el.querySelector("[data-reduce-motion]");
      const reset = w.el.querySelector("[data-reset]");

      function apply(){
        document.documentElement.style.setProperty("--pf-ui-scale", String(state.uiScale/100));
        if (state.reduceMotion === "on") document.documentElement.classList.add("pf-reduce-motion");
        else if (state.reduceMotion === "off") document.documentElement.classList.remove("pf-reduce-motion");
        else document.documentElement.classList.remove("pf-reduce-motion");
      }

      if (scale){ scale.value = String(state.uiScale); scale.addEventListener("input", ()=>{ state.uiScale = Number(scale.value); apply(); save(state); }); }
      if (rm){ rm.value = state.reduceMotion; rm.addEventListener("change", ()=>{ state.reduceMotion = rm.value; apply(); save(state); }); }
      if (reset){ reset.addEventListener("click", ()=>{ state.uiScale = 100; state.reduceMotion = "system"; apply(); save(state); if(scale) scale.value="100"; if(rm) rm.value="system"; }); }

      apply();
      return w;
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
            <div class="pf-windesc">Design text-based SVGs with quick styling controls, export presets, and one-click download.</div>

            <div style="margin-top:10px;display:grid;grid-template-columns: 1.2fr .8fr; gap:12px; align-items:start;">
              <div style="border:1px solid #c3cbd9;border-radius:2px;padding:12px;background:#f5f7fb;">
                <div class="pf-winrow" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
                  <div style="flex:1;min-width:220px;">
                    <label class="pf-winlabel">Text</label>
                    <input class="pf-wininput" type="text" value="${productUrl ? escapeHtml(productTitle) : "PHIA'S FAB"}" data-text>
                  </div>
                  <div style="width:160px;min-width:140px;">
                    <label class="pf-winlabel">Font</label>
                    <select class="pf-wininput" data-font>
                      <option value="Arial">Arial</option>
                      <option value="Segoe UI">Segoe UI</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Trebuchet MS">Trebuchet MS</option>
                      <option value="Impact">Impact</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Courier New">Courier New</option>
                    </select>
                  </div>
                  <div style="width:120px;">
                    <label class="pf-winlabel">Font size</label>
                    <input class="pf-wininput" type="number" value="96" min="10" max="400" step="1" data-size>
                  </div>
                </div>

                <div class="pf-winrow" style="gap:10px;margin-top:10px;align-items:flex-end;flex-wrap:wrap;">
                  <div style="width:140px;">
                    <label class="pf-winlabel">Fill</label>
                    <input class="pf-wininput" type="color" value="#ffffff" data-fill>
                  </div>
                  <div style="width:140px;">
                    <label class="pf-winlabel">Stroke</label>
                    <input class="pf-wininput" type="color" value="#00e5ff" data-stroke>
                  </div>
                  <div style="width:120px;">
                    <label class="pf-winlabel">Stroke width</label>
                    <input class="pf-wininput" type="number" value="3" min="0" max="30" step="0.5" data-strokew>
                  </div>
                  <div style="width:140px;">
                    <label class="pf-winlabel">Letter spacing</label>
                    <input class="pf-wininput" type="number" value="0" min="-20" max="60" step="0.5" data-spacing>
                  </div>
                </div>

                <div style="margin-top:12px;">
                  <label class="pf-winlabel">Curve (0 = straight)</label>
                  <input class="pf-wininput" type="range" min="-100" max="100" value="0" data-curve>
                  <div class="pf-windesc" style="margin-top:6px;">Negative curves downward, positive curves upward.</div>
                </div>

                <div class="pf-winrow" style="gap:10px;margin-top:12px;align-items:flex-end;flex-wrap:wrap;">
                  <div style="width:160px;">
                    <label class="pf-winlabel">Canvas preset</label>
                    <select class="pf-wininput" data-preset>
                      <option value="12x12">12x12 in</option>
                      <option value="8.5x11">8.5x11 in</option>
                      <option value="A4">A4</option>
                      <option value="square">Square 2000px</option>
                      <option value="wide">Wide 3000x1500</option>
                    </select>
                  </div>
                  <div style="width:150px;">
                    <label class="pf-winlabel">Padding</label>
                    <input class="pf-wininput" type="number" value="120" min="0" max="800" step="5" data-pad>
                  </div>
                  <div style="width:160px;">
                    <label class="pf-winlabel">Background</label>
                    <input class="pf-wininput" type="color" value="#000000" data-bg>
                  </div>
                  <button class="pf-winbtn" type="button" data-generate>Generate</button>
                  <button class="pf-winbtn pf-winbtn--ghost" type="button" data-download disabled>Download SVG</button>
                </div>

                <div style="margin-top:12px;border:1px solid #c3cbd9;border-radius:2px;padding:10px;background:#f5f7fb;">
                  <div class="pf-windesc" style="margin-bottom:6px;">Preview</div>
                  <div data-preview style="overflow:auto;max-height:320px;"></div>
                </div>
              </div>

              <div style="border:1px solid #c3cbd9;border-radius:2px;padding:12px;background:#f5f7fb;">
                <div class="pf-windesc">Quick actions</div>
                <div class="pf-winrow" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
                  <button class="pf-winbtn pf-winbtn--ghost" type="button" data-save-preset>Save preset</button>
                  <button class="pf-winbtn pf-winbtn--ghost" type="button" data-load-preset>Load preset</button>
                  <button class="pf-winbtn pf-winbtn--ghost" type="button" data-copy>Copy SVG</button>
                </div>
                <div class="pf-windesc" style="margin-top:12px;">Saved presets are stored locally in this browser.</div>
              </div>
            </div>
          </div>
<div data-panel="svg" hidden style="margin-top:12px;">
            <div class="pf-windesc">Paste SVG markup to preview it.</div>
            <textarea class="pf-wininput" style="height:160px;white-space:pre;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;" data-svginput></textarea>
            <div class="pf-winrow" style="margin-top:8px;">
              <button class="pf-winbtn" type="button" data-render>Render</button>
              <button class="pf-winbtn pf-winbtn--ghost" type="button" data-clearsvg>Clear</button>
            </div>
            <div style="margin-top:12px;border:1px solid #c3cbd9;border-radius:2px;padding:10px;background:#f5f7fb;">
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
      // Text -> SVG designer (advanced)
      const tIn = body.querySelector("[data-text]");
      const fontSel = body.querySelector("[data-font]");
      const sizeIn = body.querySelector("[data-size]");
      const fillIn = body.querySelector("[data-fill]");
      const strokeIn = body.querySelector("[data-stroke]");
      const swIn = body.querySelector("[data-strokew]");
      const spIn = body.querySelector("[data-spacing]");
      const curveIn = body.querySelector("[data-curve]");
      const presetSel = body.querySelector("[data-preset]");
      const padIn = body.querySelector("[data-pad]");
      const bgIn = body.querySelector("[data-bg]");
      const genBtn = body.querySelector("[data-generate]");
      const dlBtn = body.querySelector("[data-download]");
      const prev = body.querySelector("[data-preview]");
      const btnSavePreset = body.querySelector("[data-save-preset]");
      const btnLoadPreset = body.querySelector("[data-load-preset]");
      const btnCopy = body.querySelector("[data-copy]");

      let lastSvg = "";

      const presets = {
        "12x12": { w: 3600, h: 3600 },
        "8.5x11": { w: 2550, h: 3300 },
        "A4": { w: 2480, h: 3508 },
        "square": { w: 2000, h: 2000 },
        "wide": { w: 3000, h: 1500 }
      };

      const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
      const escAttr = (s) => String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const escText = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

      function getDesign(){
        const text = tIn?.value || "PHIA'S FAB";
        const font = fontSel?.value || "Segoe UI";
        const size = clamp(Number(sizeIn?.value || 96), 10, 400);
        const fill = fillIn?.value || "#ffffff";
        const stroke = strokeIn?.value || "#00e5ff";
        const strokeW = clamp(Number(swIn?.value || 0), 0, 40);
        const spacing = clamp(Number(spIn?.value || 0), -30, 120);
        const curve = clamp(Number(curveIn?.value || 0), -100, 100);
        const preset = presetSel?.value || "12x12";
        const pad = clamp(Number(padIn?.value || 120), 0, 1200);
        const bg = bgIn?.value || "#000000";
        const dim = presets[preset] || presets["12x12"];
        return { text, font, size, fill, stroke, strokeW, spacing, curve, preset, pad, bg, w: dim.w, h: dim.h };
      }

      function makeSvg(design){
        const id = "pfpath_" + Math.random().toString(16).slice(2);
        const safeText = escText(design.text);

        // baseline and curve geometry
        const cx = design.w / 2;
        const cy = design.h / 2;
        const amp = (design.h * 0.18) * (design.curve / 100); // amplitude
        const x0 = design.pad;
        const x1 = design.w - design.pad;

        // Quadratic curve: M x0,cy Q cx,cy-amp x1,cy
        const qy = cy - amp;
        const d = `M ${x0} ${cy} Q ${cx} ${qy} ${x1} ${cy}`;

        const letterSpacing = design.spacing; // px-ish
        const textAttrs = `font-family="${escAttr(design.font)}, system-ui, sans-serif" font-size="${design.size}" letter-spacing="${letterSpacing}"`;

        const bgRect = design.bg && design.bg !== "transparent"
          ? `<rect width="100%" height="100%" fill="${escAttr(design.bg)}"/>`
          : `<rect width="100%" height="100%" fill="transparent"/>`;

        const usePath = Math.abs(design.curve) > 0.5;

        const textEl = usePath
          ? `<text ${textAttrs} fill="${escAttr(design.fill)}" ${design.strokeW>0 ? `stroke="${escAttr(design.stroke)}" stroke-width="${design.strokeW}" paint-order="stroke"` : ""}>
               <textPath href="#${id}" startOffset="50%" text-anchor="middle">${safeText}</textPath>
             </text>`
          : `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
                 ${textAttrs}
                 fill="${escAttr(design.fill)}"
                 ${design.strokeW>0 ? `stroke="${escAttr(design.stroke)}" stroke-width="${design.strokeW}" paint-order="stroke"` : ""}>${safeText}</text>`;

        const defs = usePath ? `<defs><path id="${id}" d="${d}" /></defs>` : "";

        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${design.w}" height="${design.h}" viewBox="0 0 ${design.w} ${design.h}">
  ${bgRect}
  ${defs}
  ${textEl}
</svg>`;
      }

      function renderSvg(svg){
        lastSvg = svg;
        if (prev) prev.innerHTML = svg;
        if (dlBtn) dlBtn.disabled = !svg;
      }

      function downloadSvg(){
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
      }

      function copySvg(){
        if (!lastSvg) return;
        try{
          navigator.clipboard.writeText(lastSvg);
        }catch(e){
          // fallback
          const ta = document.createElement("textarea");
          ta.value = lastSvg;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
      }

      const presetKey = "pf_studio_design_preset_v1";
      function savePreset(){
        const d = getDesign();
        localStorage.setItem(presetKey, JSON.stringify(d));
      }
      function loadPreset(){
        try{
          const raw = localStorage.getItem(presetKey);
          if (!raw) return;
          const d = JSON.parse(raw);
          if (tIn && d.text != null) tIn.value = d.text;
          if (fontSel && d.font) fontSel.value = d.font;
          if (sizeIn && d.size) sizeIn.value = String(d.size);
          if (fillIn && d.fill) fillIn.value = d.fill;
          if (strokeIn && d.stroke) strokeIn.value = d.stroke;
          if (swIn && d.strokeW != null) swIn.value = String(d.strokeW);
          if (spIn && d.spacing != null) spIn.value = String(d.spacing);
          if (curveIn && d.curve != null) curveIn.value = String(d.curve);
          if (presetSel && d.preset) presetSel.value = d.preset;
          if (padIn && d.pad != null) padIn.value = String(d.pad);
          if (bgIn && d.bg) bgIn.value = d.bg;
          const svg = makeSvg(getDesign());
          renderSvg(svg);
        }catch(e){}
      }

      genBtn?.addEventListener("click", () => renderSvg(makeSvg(getDesign())));
      dlBtn?.addEventListener("click", downloadSvg);
      btnCopy?.addEventListener("click", copySvg);
      btnSavePreset?.addEventListener("click", savePreset);
      btnLoadPreset?.addEventListener("click", loadPreset);

      // auto-regenerate on changes (lightweight)
      const autoInputs = [tIn,fontSel,sizeIn,fillIn,strokeIn,swIn,spIn,curveIn,presetSel,padIn,bgIn].filter(Boolean);
      autoInputs.forEach(el => el.addEventListener("input", () => renderSvg(makeSvg(getDesign()))));

      // initial render
      renderSvg(makeSvg(getDesign()));



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
        const img = item.image ? `<img src="${item.image}" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:2px;">` : `<div style="width:52px;height:52px;border-radius:2px;background:#f0f3f8;border:1px solid #c3cbd9;"></div>`;
        return `
          <div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #c3cbd9;">
            ${img}
            <div style="flex:1; min-width:0;">
              <div style="font-weight:650;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
              <div style="color:#526173;font-size:12px;">$${price}</div>
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
