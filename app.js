(() => {
  "use strict";

  const CONFIG = window.TORNEO_CONFIG || {};
  const STAGES = [
    ["playoffs", "Play-off"],
    ["roundOf16", "Ottavi"],
    ["quarterfinals", "Quarti"],
    ["semifinals", "Semifinali"],
    ["final", "Finale"]
  ];

  const state = {
    data: null,
    activeView: "dashboard",
    activeRound: 1,
    activeStage: "playoffs",
    refreshTimer: null,
    loading: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const text = (value) => value === null || value === undefined ? "" : String(value).trim();
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : null;
  };
  const escapeHtml = (value) => text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const normalize = (value) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function loadJsonp() {
    return new Promise((resolve, reject) => {
      const url = text(CONFIG.appsScriptUrl);
      if (!url) {
        reject(new Error("Endpoint Apps Script non configurato."));
        return;
      }

      const callbackName = `__briscola_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const separator = url.includes("?") ? "&" : "?";
      let settled = false;

      const cleanup = () => {
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      };

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Il gestionale non ha risposto entro il tempo previsto."));
      }, Number(CONFIG.requestTimeoutMs) || 18000);

      window[callbackName] = (payload) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        if (!payload || payload.ok !== true) {
          reject(new Error(payload?.error || "Risposta non valida dal gestionale."));
          return;
        }
        resolve(payload);
      };

      script.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        reject(new Error("Impossibile collegarsi al gestionale."));
      };

      script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
      script.async = true;
      document.head.appendChild(script);
    });
  }

  function showError(message) {
    const banner = $("#error-banner");
    banner.textContent = message;
    banner.classList.remove("hidden");
  }

  function clearError() {
    $("#error-banner").classList.add("hidden");
  }

  function setLoading(show) {
    const overlay = $("#loading-screen");
    if (show) overlay.classList.remove("done");
    else overlay.classList.add("done");
  }

  function formatUpdate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  }

  function isCompleted(status) {
    const value = normalize(status);
    return value.includes("conclus") || value.includes("complet") || value.includes("terminat");
  }

  function isCheck(status) {
    return normalize(status).includes("verific");
  }

  function score(value) {
    const n = numberOrNull(value);
    return n === null ? "—" : String(n);
  }

  function pairLabel(pair, fallback) {
    return text(pair) || text(fallback) || "Da definire";
  }

  function matchWinnerId(match) {
    const explicit = numberOrNull(match.winnerId);
    if (explicit !== null) return explicit;
    const a = numberOrNull(match.scoreA);
    const b = numberOrNull(match.scoreB);
    if (a === null || b === null || a === b) return null;
    return a > b ? numberOrNull(match.pairAId) : numberOrNull(match.pairBId);
  }

  function renderMatchCard(match, options = {}) {
    const winnerId = matchWinnerId(match);
    const aId = numberOrNull(match.pairAId);
    const bId = numberOrNull(match.pairBId);
    const status = text(match.status) || "Da definire";
    const title = options.title || text(match.match) || `Tavolo ${text(match.table) || "—"}`;
    const subtitleA = text(match.sourceA) || (aId ? `Coppia ${aId}` : "");
    const subtitleB = text(match.sourceB) || (bId ? `Coppia ${bId}` : "");
    const statusClass = isCompleted(status) ? "done" : isCheck(status) ? "check" : "";

    return `
      <article class="match-card">
        <header class="match-card-header">
          <strong>${escapeHtml(title)}</strong>
          <span class="match-status ${statusClass}">${escapeHtml(status)}</span>
        </header>
        <div class="match-sides">
          <div class="match-side ${winnerId !== null && winnerId === aId ? "winner" : ""}">
            <div class="match-side-name">
              <strong>${escapeHtml(pairLabel(match.pairA, match.sourceA))}</strong>
              ${subtitleA ? `<small>${escapeHtml(subtitleA)}</small>` : ""}
            </div>
            <span class="match-score">${score(match.scoreA)}</span>
          </div>
          <div class="match-side ${winnerId !== null && winnerId === bId ? "winner" : ""}">
            <div class="match-side-name">
              <strong>${escapeHtml(pairLabel(match.pairB, match.sourceB))}</strong>
              ${subtitleB ? `<small>${escapeHtml(subtitleB)}</small>` : ""}
            </div>
            <span class="match-score">${score(match.scoreB)}</span>
          </div>
        </div>
        ${text(match.notes) ? `<p class="match-notes">${escapeHtml(match.notes)}</p>` : ""}
      </article>`;
  }

  function renderBracketMatch(match) {
    const winnerId = matchWinnerId(match);
    const aId = numberOrNull(match.pairAId);
    const bId = numberOrNull(match.pairBId);
    return `
      <article class="bracket-match">
        <div class="bracket-match-label"><span>${escapeHtml(text(match.match) || "Incontro")}</span><span>${escapeHtml(text(match.status) || "")}</span></div>
        <div class="bracket-side ${winnerId !== null && winnerId === aId ? "winner" : ""}"><span>${escapeHtml(pairLabel(match.pairA, match.sourceA))}</span><b>${score(match.scoreA)}</b></div>
        <div class="bracket-side ${winnerId !== null && winnerId === bId ? "winner" : ""}"><span>${escapeHtml(pairLabel(match.pairB, match.sourceB))}</span><b>${score(match.scoreB)}</b></div>
      </article>`;
  }

  function renderBracket(target) {
    const board = $(target);
    const finalStages = state.data?.finalStages || {};
    board.innerHTML = STAGES.map(([key, label]) => {
      const matches = Array.isArray(finalStages[key]) ? finalStages[key] : [];
      return `
        <section class="bracket-column">
          <div class="bracket-column-header">${label}</div>
          ${matches.length ? matches.map(renderBracketMatch).join("") : '<div class="empty-state">Da definire</div>'}
        </section>`;
    }).join("");
  }

  function renderDashboard() {
    const data = state.data;
    const t = data.tournament || {};
    $("#stat-pairs").textContent = t.registeredPairs ?? "—";
    $("#stat-qualified").textContent = t.qualifiedPairs || 24;
    $("#stat-direct").textContent = t.directToRoundOf16 || 8;
    $("#stat-playoff").textContent = `9°–${t.qualifiedPairs || 24}°`;
    $("#tournament-status").textContent = text(t.finalStageStatus) || text(t.scheduleStatus) || "Torneo configurato";
    $("#last-update").textContent = `Ultimo aggiornamento: ${formatUpdate(data.generatedAt)}`;

    const standings = Array.isArray(data.qualification?.standings) ? data.qualification.standings : [];
    const top = standings.filter(item => numberOrNull(item.position) !== null).sort((a,b) => a.position - b.position).slice(0,8);
    const preview = $("#ranking-preview");
    preview.classList.toggle("empty-state", top.length === 0);
    preview.innerHTML = top.length ? top.map(item => `
      <div class="ranking-preview-row">
        <span class="rank-number">${escapeHtml(item.position)}</span>
        <div class="pair-name"><strong>${escapeHtml(item.pair)}</strong><small>${escapeHtml(item.outcome || "Classifica provvisoria")}</small></div>
        <div class="ranking-points"><strong>${escapeHtml(item.points)}</strong><small>punti</small></div>
      </div>`).join("") : "La classifica comparirà quando saranno disponibili le coppie.";

    const finalMatches = Array.isArray(data.finalStages?.final) ? data.finalStages.final : [];
    const finalMatch = finalMatches.find(match => text(match.winner)) || finalMatches.find(match => matchWinnerId(match) !== null);
    const winner = text(finalMatch?.winner) || (matchWinnerId(finalMatch || {}) === numberOrNull(finalMatch?.pairAId) ? text(finalMatch?.pairA) : text(finalMatch?.pairB));
    $("#winner-banner").classList.toggle("hidden", !winner);
    if (winner) $("#winner-name").textContent = winner;

    renderBracket("#dashboard-bracket");
  }

  function renderRoundTabs() {
    const matches = Array.isArray(state.data?.qualification?.matches) ? state.data.qualification.matches : [];
    const rounds = [...new Set(matches.map(match => Number(match.round)).filter(Number.isFinite))].sort((a,b) => a-b);
    if (!rounds.length) rounds.push(1,2,3,4);
    if (!rounds.includes(state.activeRound)) state.activeRound = rounds[0];
    $("#round-tabs").innerHTML = rounds.map(round => `<button class="round-tab ${round === state.activeRound ? "active" : ""}" type="button" role="tab" data-round="${round}">Turno ${round}</button>`).join("");
  }

  function renderCalendar() {
    renderRoundTabs();
    const t = state.data.tournament || {};
    $("#calendar-status").textContent = text(t.scheduleStatus) || "Calendario";
    const all = Array.isArray(state.data.qualification?.matches) ? state.data.qualification.matches : [];
    const matches = all.filter(match => Number(match.round) === state.activeRound).sort((a,b) => Number(a.table) - Number(b.table));
    $("#calendar-summary").textContent = matches.length ? `${matches.length} incontri nel turno ${state.activeRound}.` : `Nessun incontro disponibile per il turno ${state.activeRound}.`;
    $("#matches-grid").innerHTML = matches.length ? matches.map(match => renderMatchCard(match, { title: `Tavolo ${text(match.table) || "—"}` })).join("") : '<div class="empty-state">Calendario non ancora disponibile.</div>';
  }

  function standingsClass(position) {
    const p = numberOrNull(position);
    if (p === null) return "";
    if (p <= 8) return `${p === 8 ? "direct direct-cutoff" : "direct"}`;
    if (p <= 24) return `${p === 24 ? "playoff-zone playoff-cutoff" : "playoff-zone"}`;
    return "eliminated";
  }

  function renderStandings() {
    const query = normalize($("#standings-search").value);
    const standings = (Array.isArray(state.data?.qualification?.standings) ? state.data.qualification.standings : [])
      .filter(item => !query || normalize(item.pair).includes(query));
    $("#standings-body").innerHTML = standings.length ? standings.map(item => `
      <tr class="${standingsClass(item.position)}">
        <td><span class="position-chip">${item.position ?? "—"}</span></td>
        <td><strong>${escapeHtml(item.pair)}</strong></td>
        <td class="center">${escapeHtml(item.played)}</td>
        <td class="center">${escapeHtml(item.wins)}</td>
        <td class="center">${escapeHtml(item.losses)}</td>
        <td class="center">${escapeHtml(item.raysFor)}</td>
        <td class="center">${escapeHtml(item.raysAgainst)}</td>
        <td class="center">${Number(item.rayDifference) > 0 ? "+" : ""}${escapeHtml(item.rayDifference)}</td>
        <td class="center main-score">${escapeHtml(item.points)}</td>
        <td><span class="outcome-chip">${escapeHtml(item.outcome || item.tieCriterion || "—")}</span></td>
      </tr>`).join("") : '<tr><td colspan="10" class="empty-state">Nessuna coppia trovata.</td></tr>';
  }

  function renderTiebreaks() {
    const matches = Array.isArray(state.data?.qualification?.decisiveTiebreaks) ? state.data.qualification.decisiveTiebreaks : [];
    const target = $("#tiebreak-groups");
    if (!matches.length) {
      target.innerHTML = '<div class="empty-state">Al momento non è richiesto alcuno spareggio decisivo.</div>';
      return;
    }
    const groups = new Map();
    for (const match of matches) {
      const key = text(match.boundary) || "Spareggio decisivo";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(match);
    }
    target.innerHTML = [...groups.entries()].map(([boundary, group]) => `
      <section class="tiebreak-group">
        <h3>${escapeHtml(boundary)}</h3>
        <div class="matches-grid">${group.map(match => renderMatchCard(match, { title: `Spareggio ${escapeHtml(match.id)}` })).join("")}</div>
      </section>`).join("");
  }

  function renderFinals() {
    const t = state.data.tournament || {};
    $("#finals-status").textContent = text(t.finalStageStatus) || "Fase finale";
    $$(".final-stage-tab").forEach(button => button.classList.toggle("active", button.dataset.stage === state.activeStage));
    const matches = Array.isArray(state.data.finalStages?.[state.activeStage]) ? state.data.finalStages[state.activeStage] : [];
    const label = STAGES.find(([key]) => key === state.activeStage)?.[1] || "Fase finale";
    $("#final-stage-summary").textContent = matches.length ? `${label}: ${matches.length} ${matches.length === 1 ? "incontro" : "incontri"}.` : `${label}: tabellone non ancora definito.`;
    $("#final-stage-grid").innerHTML = matches.length ? matches.map(match => renderMatchCard(match)).join("") : '<div class="empty-state">Questa fase verrà popolata automaticamente dal gestionale.</div>';
    renderBracket("#full-bracket");
  }

  function renderRules() {
    const rows = Array.isArray(state.data?.regulation) ? state.data.regulation : [];
    if (!rows.length) {
      $("#rules-content").innerHTML = '<div class="empty-state">Regolamento non disponibile.</div>';
      return;
    }
    const sections = [];
    let current = { title: "Regolamento", rows: [] };
    for (const row of rows) {
      const title = text(row.title);
      const detail = text(row.detail);
      if (title && !detail && (/^\d+[.)]?\s/.test(title) || title === title.toUpperCase())) {
        if (current.rows.length || current.title !== "Regolamento") sections.push(current);
        current = { title, rows: [] };
      } else if (title || detail) {
        current.rows.push({ title, detail });
      }
    }
    if (current.rows.length || current.title !== "Regolamento") sections.push(current);
    $("#rules-content").innerHTML = sections.map(section => `
      <section class="rule-section">
        <h3>${escapeHtml(section.title)}</h3>
        ${section.rows.map(row => `<div class="rule-row"><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.detail)}</span></div>`).join("")}
      </section>`).join("");
  }

  function renderAll() {
    renderDashboard();
    renderCalendar();
    renderStandings();
    renderTiebreaks();
    renderFinals();
    renderRules();
  }

  function activateView(view, updateHash = true) {
    if (!$("#" + view)) view = "dashboard";
    state.activeView = view;
    $$(".view").forEach(section => section.classList.toggle("active", section.id === view));
    $$(".nav-button").forEach(button => {
      const selected = button.dataset.view === view || (button.classList.contains("nav-dropdown-toggle") && ["calendario", "classifica", "spareggi"].includes(view));
      button.classList.toggle("active", selected);
      if (button.dataset.view) button.toggleAttribute("aria-current", selected);
    });
    $(".nav-dropdown")?.classList.remove("open");
    $(".nav-dropdown-toggle")?.setAttribute("aria-expanded", "false");
    if (updateHash) history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refresh({ initial = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (initial) setLoading(true);
    try {
      const data = await loadJsonp();
      state.data = data;
      clearError();
      renderAll();
    } catch (error) {
      showError(`${error.message} Riprova tra qualche secondo o controlla il deployment di Apps Script.`);
    } finally {
      state.loading = false;
      if (initial) setLoading(false);
    }
  }

  function scheduleRefresh() {
    window.clearInterval(state.refreshTimer);
    const configured = Number(CONFIG.refreshMs);
    const payload = Number(state.data?.tournament?.refreshSeconds) * 1000;
    const interval = Math.max(5000, configured || payload || 10000);
    state.refreshTimer = window.setInterval(() => refresh(), interval);
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) activateView(viewButton.dataset.view);

      const openButton = event.target.closest("[data-open-view]");
      if (openButton) activateView(openButton.dataset.openView);

      const roundButton = event.target.closest("[data-round]");
      if (roundButton) {
        state.activeRound = Number(roundButton.dataset.round);
        renderCalendar();
      }

      const stageButton = event.target.closest("[data-stage]");
      if (stageButton) {
        state.activeStage = stageButton.dataset.stage;
        renderFinals();
      }

      const dropdownToggle = event.target.closest(".nav-dropdown-toggle");
      if (dropdownToggle) {
        const dropdown = dropdownToggle.closest(".nav-dropdown");
        const open = !dropdown.classList.contains("open");
        dropdown.classList.toggle("open", open);
        dropdownToggle.setAttribute("aria-expanded", String(open));
      } else if (!event.target.closest(".nav-dropdown")) {
        $(".nav-dropdown")?.classList.remove("open");
        $(".nav-dropdown-toggle")?.setAttribute("aria-expanded", "false");
      }
    });

    $("#standings-search").addEventListener("input", renderStandings);
    window.addEventListener("hashchange", () => activateView(location.hash.slice(1) || "dashboard", false));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) window.clearInterval(state.refreshTimer);
      else { refresh(); scheduleRefresh(); }
    });
  }

  async function init() {
    bindEvents();
    activateView(location.hash.slice(1) || "dashboard", false);
    await refresh({ initial: true });
    scheduleRefresh();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
