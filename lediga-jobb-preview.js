(function () {
  "use strict";

  const app = document.getElementById("jobs-app");
  const indexHero = document.getElementById("jobs-index-hero");
  const emptyTemplate = document.getElementById("jobs-empty-template");
  if (!app || !indexHero || !emptyTemplate) return;

  const params = new URLSearchParams(window.location.search);
  const demoMode = params.get("demo") === "1";
  const showcaseMode = params.get("showcase") === "1";
  const pageTitle = document.title;
  const dateFormat = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" });
  let jobs = [];

  const demoJobs = [{
    title: "Projektledare inom bygg",
    assignment_id: "12345",
    slug: "projektledare-inom-bygg",
    excerpt: "Vill du leda byggprojekt där kvalitet, samarbete och tydliga beslut står i centrum? Vi söker en erfaren projektledare till ett växande bolag i Göteborg.",
    body: "<h2>Om rollen</h2><p>Som projektledare ansvarar du för projektets helhet – från planering och ekonomi till genomförande och överlämning. Du samordnar interna och externa parter och skapar goda förutsättningar för teamet.</p><h2>Vi söker dig som</h2><ul><li>Har erfarenhet av att leda byggprojekt</li><li>Arbetar strukturerat och affärsmässigt</li><li>Trivs i nära dialog med kunder och kollegor</li></ul><h2>Om processen</h2><p>Prio Rekrytering ansvarar för processen. Urval och intervjuer sker löpande.</p>",
    organization_name: "Exempel Bygg AB",
    location: "Göteborg",
    publish_date: "2026-09-14T08:00:00",
    name: "Jenniefer Berg",
    user_title: "Rekryteringskonsult",
    email: "kontakt@priorekrytering.se",
    showcase: false,
    demo: true
  }];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
  }

  function safeUrl(value, protocols = ["https:"]) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      return protocols.includes(url.protocol) ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function slugify(value) {
    return String(value || "jobb")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "jobb";
  }

  function normalizeJob(raw) {
    const address = raw.address && typeof raw.address === "object" ? raw.address : {};
    const id = String(raw.assignment_id ?? raw.assignmentId ?? raw.id ?? "");
    const title = String(raw.title || "Ledig tjänst");
    return {
      id,
      title,
      slug: String(raw.title_slug || raw.slug || slugify(title)),
      excerpt: String(raw.excerpt || raw.meta_description || ""),
      body: String(raw.body || raw.description || ""),
      organization: String(raw.organization_name || raw.organization || ""),
      location: String(raw.location || address.city || raw.region || ""),
      publishDate: String(raw.publish_date || raw.published_at || ""),
      withdrawalDate: String(raw.withdrawal_date || ""),
      name: String(raw.name || raw.user_name || ""),
      userTitle: String(raw.user_title || ""),
      email: String(raw.email || raw.user_email || ""),
      phone: String(raw.phone || raw.user_phone || ""),
      logo: raw.logo === false ? "" : safeUrl(raw.image_url || raw.logo),
      externalApplyUrl: safeUrl(raw.external_apply_url || raw.apply_url),
      showcase: Boolean(raw.showcase) || showcaseMode,
      demo: Boolean(raw.demo)
    };
  }

  function routeFor(job) {
    return `#jobb/${encodeURIComponent(job.slug)}-${encodeURIComponent(job.id)}`;
  }

  function selectedJob() {
    if (!window.location.hash.startsWith("#jobb/")) return null;
    let route = "";
    try { route = decodeURIComponent(window.location.hash.slice(6)); }
    catch (_error) { route = window.location.hash.slice(6); }
    return [...jobs].sort((a, b) => b.id.length - a.id.length).find(job => route.endsWith(`-${job.id}`)) || false;
  }

  function formattedDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
  }

  function sanitizeHtml(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");
    const allowedTags = new Set(["A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "FIGCAPTION", "FIGURE", "H2", "H3", "H4", "HR", "I", "IMG", "LI", "OL", "P", "SPAN", "STRONG", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);
    const removeEntirely = new Set(["IFRAME", "OBJECT", "SCRIPT", "STYLE", "SVG"]);
    [...template.content.querySelectorAll("*")].forEach(element => {
      if (removeEntirely.has(element.tagName)) {
        element.remove();
        return;
      }
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(...element.childNodes);
        return;
      }
      const hrefValue = element.getAttribute("href");
      const srcValue = element.getAttribute("src");
      [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
      if (element.tagName === "A") {
        const href = safeUrl(hrefValue, ["https:", "http:", "mailto:", "tel:"]);
        if (href) {
          element.setAttribute("href", href);
          element.setAttribute("rel", "noopener noreferrer");
        }
      }
      if (element.tagName === "IMG") {
        const src = safeUrl(srcValue);
        if (src) {
          element.setAttribute("src", src);
          element.setAttribute("alt", "");
          element.setAttribute("loading", "lazy");
          element.setAttribute("decoding", "async");
        } else element.remove();
      }
    });
    return template.innerHTML;
  }

  function openPopup(url) {
    const popupWidth = Math.max(320, Math.min(960, window.screen.availWidth - 40));
    const popupHeight = Math.max(500, Math.min(900, window.screen.availHeight - 40));
    const popupLeft = (window.screen.availLeft || 0) + Math.round((window.screen.availWidth - popupWidth) / 2);
    const popupTop = (window.screen.availTop || 0) + Math.round((window.screen.availHeight - popupHeight) / 2);
    const features = `popup=yes,width=${popupWidth},height=${popupHeight},left=${popupLeft},top=${popupTop},resizable=yes,scrollbars=yes`;
    const popup = window.open(url, "pnty_application", features);
    if (popup) {
      popup.opener = null;
      popup.focus();
    }
  }

  function renderModeLabel() {
    if (demoMode) return '<span class="jobs-mode">Testdata</span>';
    if (showcaseMode) return '<span class="jobs-mode">Referensannonser</span>';
    return "";
  }

  function renderList() {
    indexHero.hidden = false;
    document.body.classList.remove("showing-job");
    document.title = pageTitle;
    if (!jobs.length) {
      app.innerHTML = `${renderModeLabel()}${emptyTemplate.innerHTML}`;
      return;
    }
    const cards = jobs.map(job => {
      const meta = [job.organization, job.location, formattedDate(job.publishDate)].filter(Boolean);
      return `<a class="job-card" href="${routeFor(job)}">
        <div><h3>${escapeHtml(job.title)}</h3>${job.excerpt ? `<p>${escapeHtml(job.excerpt)}</p>` : ""}</div>
        <div class="job-card-meta">${meta.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        <span class="job-card-arrow" aria-hidden="true">→</span>
      </a>`;
    }).join("");
    app.innerHTML = `${renderModeLabel()}<header class="jobs-app-heading"><p class="kicker">Aktuella möjligheter</p><div><h2>Lediga jobb</h2><span class="jobs-count">${jobs.length} ${jobs.length === 1 ? "tjänst" : "tjänster"}</span></div></header><div class="jobs-list">${cards}</div>`;
  }

  function contactMarkup(job) {
    if (!job.name && !job.email && !job.phone) return "";
    const phoneHref = job.phone ? `tel:${job.phone.replace(/[^+\d]/g, "")}` : "";
    return `<div class="job-contact"><strong>${escapeHtml(job.name || "Prio Rekrytering")}</strong>${job.userTitle ? `<span>${escapeHtml(job.userTitle)}</span>` : ""}${job.email ? `<a href="mailto:${escapeHtml(job.email)}">${escapeHtml(job.email)}</a>` : ""}${job.phone ? `<a href="${phoneHref}">${escapeHtml(job.phone)}</a>` : ""}</div>`;
  }

  function renderDetail(job) {
    indexHero.hidden = true;
    document.body.classList.add("showing-job");
    if (!job) {
      document.title = `Jobbet kunde inte hittas | Prio Rekrytering`;
      app.innerHTML = `<div class="jobs-error"><a class="job-back" href="${escapeHtml(window.location.pathname + window.location.search)}">← Alla lediga jobb</a><h2>Jobbet kunde inte hittas.</h2><p>Annonsen kan ha stängts eller fått en ny adress.</p></div>`;
      return;
    }
    document.title = `${job.title} | Prio Rekrytering`;
    const facts = [
      job.organization ? ["Företag", job.organization] : null,
      job.location ? ["Plats", job.location] : null,
      formattedDate(job.publishDate) ? ["Publicerad", formattedDate(job.publishDate)] : null
    ].filter(Boolean);
    const applyUrl = job.externalApplyUrl || `${app.dataset.applyBase}?id=${encodeURIComponent(job.id)}`;
    const sidebarTitle = job.organization || "Om tjänsten";
    app.innerHTML = `<article class="job-detail">
      <a class="job-back" href="${escapeHtml(window.location.pathname + window.location.search)}">← Alla lediga jobb</a>
      ${renderModeLabel()}
      <header class="job-detail-header">
        <p class="kicker">Ledig tjänst</p>
        <h1>${escapeHtml(job.title)}</h1>
        <div class="job-detail-lede">${job.excerpt ? `<p>${escapeHtml(job.excerpt)}</p>` : "<p></p>"}<div class="job-facts">${facts.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div></div>
      </header>
      <div class="job-detail-layout">
        <div class="job-body">${sanitizeHtml(job.body) || `<p>${escapeHtml(job.excerpt)}</p>`}</div>
        <aside class="job-sidebar">
          ${job.logo ? `<img class="job-client-logo" src="${job.logo}" alt="${escapeHtml(job.organization)}" loading="lazy" decoding="async">` : ""}
          <p class="kicker">Ansökan</p><h2>${escapeHtml(sidebarTitle)}</h2>
          ${job.location ? `<p>${escapeHtml(job.location)}</p>` : ""}
          ${job.showcase ? '<p class="job-showcase-note">Detta är ett referensuppdrag och tar inte emot ansökningar.</p>' : `<a class="job-apply" href="${applyUrl}" data-job-apply>Ansök via Ponty →</a>`}
          ${contactMarkup(job)}
        </aside>
      </div>
    </article>`;
    const applyLink = app.querySelector("[data-job-apply]");
    if (applyLink) applyLink.addEventListener("click", event => {
      event.preventDefault();
      if (job.demo) {
        window.alert("Detta är en testannons. Ingen ansökan öppnas.");
        return;
      }
      openPopup(applyLink.href);
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function renderRoute() {
    const selected = selectedJob();
    if (selected === null) renderList();
    else renderDetail(selected || null);
  }

  async function loadJobs() {
    try {
      if (demoMode) jobs = demoJobs.map(normalizeJob);
      else {
        const feedUrl = `${app.dataset.feedUrl}${showcaseMode ? "&showcase=1" : ""}`;
        const response = await fetch(feedUrl, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Ponty svarade med ${response.status}.`);
        const data = await response.json();
        if (!data || !Array.isArray(data.jobs)) throw new Error("Ponty returnerade ett oväntat svar.");
        jobs = data.jobs.map(normalizeJob).filter(job => job.id);
      }
      jobs.sort((a, b) => new Date(b.publishDate || 0) - new Date(a.publishDate || 0));
      renderRoute();
    } catch (error) {
      indexHero.hidden = false;
      app.innerHTML = `<div class="jobs-error"><h2>Jobben kunde inte hämtas.</h2><p>${escapeHtml(error.message || "Försök igen om en stund.")}</p><button type="button" data-jobs-retry>Försök igen</button></div>`;
      app.querySelector("[data-jobs-retry]").addEventListener("click", loadJobs);
    }
  }

  window.addEventListener("hashchange", renderRoute);
  loadJobs();
})();
