// NomadMovie docs: tab routing, lazy demos, search, live downloads and the effect/transition catalogs.
const REPO = "faridmasjedi/NomadMovie";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- theme ---------------- */
const themeBtn = $("#theme");
const applyTheme = (t) => {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
};
try {
  applyTheme(localStorage.getItem("nm-theme"));
} catch {}
themeBtn.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("nm-theme", next);
  } catch {}
});

/* ---------------- navigation ---------------- */
const pages = $$(".page");
const nav = $("#nav");
const groups = new Map();
for (const p of pages) {
  const g = p.dataset.group;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(p);
}
for (const [g, list] of groups) {
  const box = document.createElement("div");
  box.className = "nav-group";
  box.innerHTML = `<span>${g}</span>`;
  for (const p of list) {
    const a = document.createElement("a");
    a.href = `#${p.id}`;
    a.dataset.page = p.id;
    a.innerHTML = `<span class="ic">${p.dataset.icon ?? "•"}</span>${p.dataset.title}`;
    box.appendChild(a);
  }
  nav.appendChild(box);
}

// previous / next links at the bottom of every page
pages.forEach((p, i) => {
  const prev = pages[i - 1], next = pages[i + 1];
  const pager = document.createElement("div");
  pager.className = "pager";
  pager.innerHTML =
    (prev ? `<a href="#${prev.id}"><small>← Previous</small>${prev.dataset.title}</a>` : "<span></span>") +
    (next ? `<a href="#${next.id}" style="text-align:right"><small>Next →</small>${next.dataset.title}</a>` : "<span></span>");
  p.appendChild(pager);
});

function show(id) {
  const page = pages.find((p) => p.id === id) ?? pages[0];
  for (const p of pages) p.classList.toggle("active", p === page);
  for (const a of $$("a", nav)) a.classList.toggle("active", a.dataset.page === page.id);
  document.title = page.id === "overview" ? "NomadMovie — free AI video editor" : `${page.dataset.title} · NomadMovie docs`;
  // demos load only when their page is opened
  for (const img of $$("img[data-src]", page)) {
    img.src = img.dataset.src;
    img.removeAttribute("data-src");
    img.addEventListener("load", () => {
      img.classList.add("ready");
      img.closest(".frame")?.querySelector(".loading")?.remove();
    }, { once: true });
  }
  if (page.querySelector("[data-catalog]")) buildCatalogs(page);
  $("#side").classList.remove("open");
  window.scrollTo({ top: 0 });
}
const route = () => show(decodeURIComponent(location.hash.slice(1)) || "overview");
addEventListener("hashchange", route);

// sidebar search: matches page titles and their text
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  for (const a of $$("a", nav)) {
    const p = $(`#${a.dataset.page}`);
    a.style.display = !q || p.dataset.title.toLowerCase().includes(q) || p.textContent.toLowerCase().includes(q) ? "" : "none";
  }
  for (const g of $$(".nav-group", nav)) g.style.display = $$("a", g).some((a) => a.style.display !== "none") ? "" : "none";
});
$("#menu").addEventListener("click", () => $("#side").classList.toggle("open"));

/* ---------------- demos: <figure class="demo" data-gif="name" data-caption="…"> ---------------- */
for (const f of $$("figure.demo[data-gif]")) {
  const n = f.dataset.gif;
  f.innerHTML = `<div class="frame" style="background-image:url(media/${n}.png)"><img data-src="media/${n}.gif" alt="${f.dataset.caption ?? n}" loading="lazy"><span class="loading">Loading demo…</span></div>
    <figcaption>${f.dataset.caption ?? ""}<span class="spacer"></span><a href="media/${n}.gif" target="_blank" rel="noopener">Open GIF ↗</a></figcaption>`;
}
// feature cards on the overview get their demo's poster
for (const c of $$(".card[data-gif]")) {
  const th = document.createElement("div");
  th.className = "thumb";
  th.style.backgroundImage = `url(media/${c.dataset.gif}.png)`;
  c.prepend(th);
}

/* ---------------- downloads ---------------- */
const OS = (() => {
  const ua = navigator.userAgent;
  const plat = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  if (/win/i.test(plat) || /Windows/.test(ua)) return "windows";
  if (/mac/i.test(plat) || /Mac OS X/.test(ua)) return "mac";
  if (/linux|x11/i.test(plat + ua) && !/Android/.test(ua)) return "linux";
  return "";
})();

const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const FILE_INFO = [
  [/mac-arm64\.dmg$/, "mac", "Apple Silicon (M1–M4) · installer (.dmg)", 1],
  [/mac-x64\.dmg$/, "mac", "Intel Mac · installer (.dmg)", 2],
  [/mac-arm64\.zip$/, "mac", "Apple Silicon · plain app (.zip)", 3],
  [/mac-x64\.zip$/, "mac", "Intel Mac · plain app (.zip)", 4],
  [/windows-setup\.exe$|win.*\.exe$/, "windows", "Installer (setup.exe)", 1],
  [/win-x64\.zip$/, "windows", "Portable, no install (.zip)", 2],
  [/\.AppImage$/, "linux", "AppImage (any distribution)", 1],
  [/\.deb$/, "linux", "Debian / Ubuntu (.deb)", 2],
  [/linux-x64\.zip$/, "linux", "Plain app (.zip)", 3],
];
const OS_META = {
  mac: { name: "macOS", icon: "", hint: "macOS 12 or newer. Not sure which Mac you have? Apple menu → About This Mac: “Chip: Apple M…” means Apple Silicon, “Processor: Intel” means Intel." },
  windows: { name: "Windows", icon: "⊞", hint: "Windows 10 or 11, 64-bit." },
  linux: { name: "Linux", icon: "🐧", hint: "64-bit (x86_64). For the AppImage: right-click → Properties → allow running as a program, or chmod +x." },
};

async function buildDownloads() {
  const boxes = $$("[data-downloads]");
  if (!boxes.length) return;
  let rel = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (r.ok) rel = await r.json();
  } catch {}
  const latestUrl = `https://github.com/${REPO}/releases/latest`;
  for (const el of $$("[data-version]")) el.textContent = rel ? rel.tag_name.replace(/^v/, "") : "latest";
  for (const el of $$("[data-release-date]")) el.textContent = rel ? new Date(rel.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  const byOs = { mac: [], windows: [], linux: [] };
  for (const a of rel?.assets ?? []) {
    const info = FILE_INFO.find(([re]) => re.test(a.name));
    if (info) byOs[info[1]].push({ url: a.browser_download_url, label: info[2], order: info[3], size: a.size, name: a.name });
  }
  const order = ["mac", "windows", "linux"].sort((a, b) => (b === OS) - (a === OS));
  const html = order.map((os) => {
    const m = OS_META[os];
    const files = byOs[os].sort((a, b) => a.order - b.order);
    const list = files.length
      ? files.map((f) => `<a class="file" href="${f.url}" title="${f.name}"><span>⬇ ${f.label}</span><small>${fmtSize(f.size)}</small></a>`).join("")
      : `<a class="file" href="${latestUrl}"><span>⬇ See the latest release</span><small>GitHub</small></a>`;
    return `<div class="dl ${os === OS ? "mine" : ""}"><h3><span class="os-ic">${m.icon}</span>${m.name}${os === OS ? ' <span class="badge">Your system</span>' : ""}</h3><div class="files">${list}</div><div class="hint">${m.hint}</div></div>`;
  }).join("");
  for (const b of boxes) b.innerHTML = html;
  // the big button on the overview: best file for this visitor
  const best = byOs[OS]?.sort((a, b) => a.order - b.order)[0];
  for (const btn of $$("[data-best-download]")) {
    if (best && OS !== "mac") {
      btn.href = best.url;
    } else btn.href = "#download";
    const label = btn.querySelector("span.os");
    if (label) label.textContent = OS ? `for ${OS_META[OS].name}` : "";
  }
}

/* ---------------- catalogs ---------------- */
let catalog = null;
const built = new WeakSet();
async function buildCatalogs(page) {
  catalog ??= await fetch("data/catalog.json").then((r) => r.json()).catch(() => null);
  if (!catalog) return;
  for (const box of $$("[data-catalog]", page)) {
    if (built.has(box)) continue;
    built.add(box);
    const kind = box.dataset.catalog; // "effects" | "transitions"
    const items = kind === "effects" ? catalog.effects : catalog.transitions;
    const cats = ["All", ...(kind === "effects" ? catalog.effectCategories : catalog.transitionCategories)];
    box.innerHTML = `<div class="cat-tools"><input placeholder="Search ${items.length} ${kind}…" aria-label="Search ${kind}"></div><div class="cat-tools cats"></div><div class="cat-grid"></div>`;
    const input = $("input", box), catBox = $(".cats", box), grid = $(".cat-grid", box);
    let cat = "All";
    catBox.innerHTML = cats.map((c) => `<button data-c="${c}" class="${c === "All" ? "on" : ""}">${c}<span class="cat-count">${c === "All" ? items.length : items.filter((i) => i.category === c).length}</span></button>`).join("");
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        img.src = img.dataset.src;
        io.unobserve(img);
      }
    }, { rootMargin: "200px" });
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const list = items.filter((i) => (cat === "All" || i.category === cat) && (!q || i.label.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)));
      grid.innerHTML = list.map((i) => {
        const extra = i.params?.length || i.colors?.length ? `<small>Settings: ${[...(i.params ?? []), ...(i.colors ?? [])].join(", ")}</small>` : "";
        return `<div class="cat-item"><div class="th"><img data-src="catalog/${kind === "effects" ? "e" : "t"}-${i.id}.gif" alt="${i.label}"></div><div class="t">${i.label}<small>${i.category}</small>${extra}</div></div>`;
      }).join("") || `<p class="lead">Nothing matches “${q}”.</p>`;
      for (const img of $$("img[data-src]", grid)) io.observe(img);
    };
    input.addEventListener("input", render);
    catBox.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      cat = b.dataset.c;
      for (const x of $$("button", catBox)) x.classList.toggle("on", x === b);
      render();
    });
    render();
  }
}

route();
buildDownloads();
