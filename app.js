/* ===========================================================
   Health Chart — app logic
   ------------------------------------------------------------
   Data lives in data.json inside your GitHub repo (via the
   Contents API) so it's reachable from any device. Profiles let
   one chart hold separate records for separate people; every
   record is tagged with the profile that owned it when it was
   uploaded or edited, and the whole UI filters to whichever
   profile is currently selected (kept per-browser in
   localStorage, since "who am I looking at right now" is a
   per-device UI choice, not shared data).
=========================================================== */

(function () {
  "use strict";

  const GH_CONFIG_KEY = "health-chart-github-config";
  const ACTIVE_PROFILE_KEY = "health-chart-active-profile";
  const PROFILE_COLORS = ["lav", "pink", "sky", "mint", "peach", "sun", "coral"];
  const PROFILE_AVATARS = ["🦊","🐱","🐼","🐨","🦁","🐸","🐢","🐬","🦋","🐙","🐧","🦉","🐰","🦄","🐳","🐿️","🦔","🐝"];
  const EMPTY_RECORD = {
    patient: { name: "Not mentioned", lastUpdated: null },
    profiles: [],
    medications: [], tests: [], diagnoses: [], vitals: [], visits: [],
    symptoms: [], allergies: [], sourceDocuments: []
  };

  let state = JSON.parse(JSON.stringify(EMPTY_RECORD));
  let currentView = "overview";
  let ghConfig = loadGhConfig();
  let ghFileSha = null;
  let syncing = false;
  let activeProfileId = null;
  try { activeProfileId = localStorage.getItem(ACTIVE_PROFILE_KEY); } catch (e) {}

  function loadGhConfig() {
    try { const raw = localStorage.getItem(GH_CONFIG_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function saveGhConfig(cfg) {
    ghConfig = cfg;
    try { localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  function clearGhConfig() {
    ghConfig = null;
    try { localStorage.removeItem(GH_CONFIG_KEY); } catch (e) {}
  }
  function setActiveProfile(id) {
    activeProfileId = id;
    try { localStorage.setItem(ACTIVE_PROFILE_KEY, id); } catch (e) {}
  }

  function ghApiUrl(path) {
    return `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${path}`;
  }

  function setSyncStatus(text, cls) {
    const el = document.getElementById("syncStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "sync-status" + (cls ? " " + cls : "");
  }

  /* ---------- Profile helpers ---------- */
  function ensureProfiles() {
    if (!state.profiles || !state.profiles.length) {
      const def = { id: uid("profile"), name: "Me", color: "lav", avatar: PROFILE_AVATARS[0], createdDate: new Date().toISOString() };
      state.profiles = [def];
    }
    // Migrate any records without a profileId onto the first profile
    const fallbackId = state.profiles[0].id;
    ["medications", "tests", "diagnoses", "vitals", "visits", "symptoms", "sourceDocuments"].forEach(key => {
      (state[key] || []).forEach(r => { if (!r.profileId) r.profileId = fallbackId; });
    });
    if (!activeProfileId || !state.profiles.find(p => p.id === activeProfileId)) {
      setActiveProfile(state.profiles[0].id);
    }
  }

  function activeProfile() {
    return (state.profiles || []).find(p => p.id === activeProfileId) || null;
  }

  function forActiveProfile(key) {
    return (state[key] || []).filter(r => r.profileId === activeProfileId);
  }

  function initials(name) {
    return (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  }
  function avatarContent(p) {
    if (!p) return "?";
    return p.avatar ? p.avatar : initials(p.name);
  }

  async function fetchFromGithub() {
    if (!ghConfig) { setSyncStatus("Not connected to GitHub"); return; }
    setSyncStatus("Loading from GitHub…");
    try {
      const res = await fetch(ghApiUrl(ghConfig.path) + `?ref=${encodeURIComponent(ghConfig.branch || "main")}`, {
        headers: { Authorization: `Bearer ${ghConfig.token}`, Accept: "application/vnd.github+json" }
      });
      if (res.status === 404) {
        state = JSON.parse(JSON.stringify(EMPTY_RECORD));
        ghFileSha = null;
        ensureProfiles();
        setSyncStatus("Connected · no data.json yet", "ok");
        render();
        return;
      }
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
      const json = await res.json();
      ghFileSha = json.sha;
      const decoded = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ""))));
      state = JSON.parse(decoded);
      ensureProfiles();
      setSyncStatus("Synced with " + ghConfig.owner + "/" + ghConfig.repo, "ok");
      render();
    } catch (e) {
      setSyncStatus("Couldn't load from GitHub — check token/repo", "err");
      console.error(e);
    }
  }

  async function saveState() {
    state.patient.lastUpdated = new Date().toISOString();
    if (!ghConfig) { setSyncStatus("Not connected — changes stay in this tab only", "err"); return; }
    if (syncing) return;
    syncing = true;
    setSyncStatus("Saving to GitHub…");
    try {
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2))));
      const body = { message: "Update health chart data — " + new Date().toISOString(), content, branch: ghConfig.branch || "main" };
      if (ghFileSha) body.sha = ghFileSha;
      const res = await fetch(ghApiUrl(ghConfig.path), {
        method: "PUT",
        headers: { Authorization: `Bearer ${ghConfig.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const errBody = await res.json().catch(() => ({})); throw new Error(errBody.message || `GitHub responded ${res.status}`); }
      const json = await res.json();
      ghFileSha = json.content.sha;
      setSyncStatus("Synced with " + ghConfig.owner + "/" + ghConfig.repo, "ok");
    } catch (e) {
      setSyncStatus("Save failed: " + e.message, "err");
      console.error(e);
    } finally { syncing = false; }
  }

  function uid(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }

  function fmtDate(d) {
    if (!d || d === "Not mentioned") return "Not mentioned";
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function isUnclear(v) { return v === "⚠️ Unclear — needs review"; }
  function isMissing(v) { return v === "Not mentioned" || v === undefined || v === null || v === ""; }
  function fieldClass(v) { if (isUnclear(v)) return "unclear"; if (isMissing(v)) return "notmentioned"; return ""; }

  /* ---------- Review / pending counts (scoped to active profile) ---------- */
  function collectAll() {
    return [
      ...forActiveProfile("medications").map(r => ({ ...r, _type: "medication" })),
      ...forActiveProfile("tests").map(r => ({ ...r, _type: "test" })),
      ...forActiveProfile("diagnoses").map(r => ({ ...r, _type: "diagnosis" })),
      ...forActiveProfile("vitals").map(r => ({ ...r, _type: "vital" })),
      ...forActiveProfile("visits").map(r => ({ ...r, _type: "visit" })),
    ];
  }
  function needsReviewCount() { return collectAll().filter(r => (r.unclearFields || []).length > 0).length; }
  function pendingDocsCount() { return forActiveProfile("sourceDocuments").filter(d => d.status === "pending").length; }

  /* ---------- Rendering shell ---------- */
  function render() {
    renderProfileSwitcher();
    document.getElementById("lastUpdated").textContent = state.patient.lastUpdated
      ? "Updated " + fmtDate(state.patient.lastUpdated) : "No entries yet";
    document.getElementById("reviewCount").textContent = needsReviewCount();
    document.getElementById("pendingCount").textContent = pendingDocsCount();

    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === currentView));

    const sheet = document.getElementById("sheet");
    sheet.innerHTML = "";

    if (!activeProfileId) {
      sheet.appendChild(emptyState("No profile selected", "Add a profile from the switcher in the top left to start this chart."));
      return;
    }

    const renderers = {
      overview: renderOverview,
      inference: renderInference,
      timeline: renderTimeline,
      medications: () => renderCategory("medications", "Medications", medicationCard, "cat-med"),
      tests: () => renderCategory("tests", "Tests & Results", testCard, "cat-test"),
      diagnoses: () => renderCategory("diagnoses", "Diagnoses / Conditions", diagnosisCard, "cat-diag"),
      vitals: () => renderCategory("vitals", "Vitals Log", vitalCard, "cat-vital"),
      visits: () => renderCategory("visits", "Doctor Visits", visitCard, "cat-visit"),
      symptoms: () => renderCategory("symptoms", "Symptoms Log", symptomCard, "cat-symptom"),
      documents: renderDocuments,
      review: renderReview,
    };
    (renderers[currentView] || renderOverview)();
  }

  function renderProfileSwitcher() {
    const p = activeProfile();
    const avatarEl = document.getElementById("profileAvatar");
    avatarEl.textContent = avatarContent(p);
    avatarEl.style.background = p ? `var(--${p.color})` : "var(--lav)";
    document.getElementById("profileBtn").title = p ? p.name : "Choose profile";

    const menu = document.getElementById("profileMenu");
    menu.innerHTML = `<div class="profile-menu-label">Switch profile</div>`;
    (state.profiles || []).forEach(pr => {
      const opt = document.createElement("div");
      opt.className = "profile-option" + (pr.id === activeProfileId ? " current" : "");
      opt.innerHTML = `<span class="profile-avatar" style="background:var(--${pr.color})">${avatarContent(pr)}</span><span>${pr.name}</span>${pr.id === activeProfileId ? '<span class="profile-option-check">✓</span>' : ""}`;
      opt.onclick = () => { setActiveProfile(pr.id); closeProfileMenu(); render(); };
      menu.appendChild(opt);
    });
    const addOpt = document.createElement("div");
    addOpt.className = "profile-menu-add";
    addOpt.innerHTML = `<span class="profile-menu-add-icon">+</span><span>Add profile</span>`;
    addOpt.onclick = () => { closeProfileMenu(); openProfileForm(); };
    menu.appendChild(addOpt);
  }

  function openProfileMenu() {
    const btn = document.getElementById("profileBtn");
    const menu = document.getElementById("profileMenu");
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 10) + "px";
    menu.style.right = (window.innerWidth - rect.right) + "px";
    menu.style.left = "auto";
    menu.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
  }
  function closeProfileMenu() {
    document.getElementById("profileMenu").classList.remove("open");
    document.getElementById("profileBtn").setAttribute("aria-expanded", "false");
  }
  function toggleProfileMenu() {
    const menu = document.getElementById("profileMenu");
    if (menu.classList.contains("open")) closeProfileMenu(); else openProfileMenu();
  }

  function openProfileForm() {
    const modal = document.getElementById("modal");
    let chosenColor = PROFILE_COLORS[(state.profiles || []).length % PROFILE_COLORS.length];
    let chosenAvatar = PROFILE_AVATARS[(state.profiles || []).length % PROFILE_AVATARS.length];
    modal.innerHTML = `
      <h2>Add a profile</h2>
      <div class="modal-sub">Separate charts for separate people — e.g. yourself, a parent, a child.</div>
      <div class="form-row"><label>Name</label><input type="text" id="profName" placeholder="e.g. Mom, Alex, Dad"></div>
      <div class="form-row"><label>Avatar</label><div class="avatar-grid" id="avatarGrid"></div></div>
      <div class="form-row"><label>Color</label><div class="color-swatches" id="colorSwatches"></div></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn" type="button">Cancel</button>
        <button class="btn-primary" id="saveProfBtn" type="button">Add profile</button>
      </div>
    `;
    const ag = modal.querySelector("#avatarGrid");
    PROFILE_AVATARS.forEach(a => {
      const opt = document.createElement("div");
      opt.className = "avatar-option" + (a === chosenAvatar ? " selected" : "");
      opt.textContent = a;
      opt.onclick = () => { chosenAvatar = a; ag.querySelectorAll(".avatar-option").forEach(d => d.classList.remove("selected")); opt.classList.add("selected"); };
      ag.appendChild(opt);
    });
    const sw = modal.querySelector("#colorSwatches");
    PROFILE_COLORS.forEach(c => {
      const dot = document.createElement("div");
      dot.className = "color-swatch" + (c === chosenColor ? " selected" : "");
      dot.style.background = `var(--${c})`;
      dot.onclick = () => { chosenColor = c; sw.querySelectorAll(".color-swatch").forEach(d => d.classList.remove("selected")); dot.classList.add("selected"); };
      sw.appendChild(dot);
    });
    modal.querySelector("#cancelBtn").onclick = closeModal;
    modal.querySelector("#saveProfBtn").onclick = () => {
      const name = modal.querySelector("#profName").value.trim();
      if (!name) { alert("Give the profile a name."); return; }
      const prof = { id: uid("profile"), name, color: chosenColor, avatar: chosenAvatar, createdDate: new Date().toISOString() };
      state.profiles.push(prof);
      setActiveProfile(prof.id);
      saveState();
      closeModal();
      render();
    };
    document.getElementById("modalBackdrop").classList.add("open");
  }

  function header(title, sub, addLabel, onAdd, extraBtn) {
    const div = document.createElement("div");
    div.className = "view-header";
    div.innerHTML = `<div><h1 class="view-title">${title}</h1><div class="view-sub">${sub}</div></div>`;
    const actions = document.createElement("div");
    actions.className = "view-header-actions";
    if (extraBtn) {
      const eb = document.createElement("button");
      eb.className = "add-btn secondary";
      eb.textContent = extraBtn.label;
      eb.onclick = extraBtn.onClick;
      actions.appendChild(eb);
    }
    if (addLabel) {
      const btn = document.createElement("button");
      btn.className = "add-btn";
      btn.textContent = addLabel;
      btn.onclick = onAdd;
      actions.appendChild(btn);
    }
    div.appendChild(actions);
    return div;
  }

  function emptyState(title, sub) {
    const el = document.getElementById("tpl-empty").content.cloneNode(true);
    el.querySelector(".empty-title").textContent = title;
    el.querySelector(".empty-sub").textContent = sub;
    return el;
  }

  /* ---------- Overview ---------- */
  function renderOverview() {
    const sheet = document.getElementById("sheet");
    const p = activeProfile();
    sheet.appendChild(header("Overview", `Current snapshot for ${p ? p.name : "this profile"}`));

    const grid = document.createElement("div");
    grid.className = "overview-grid";

    const activeMeds = forActiveProfile("medications").filter(m => m.status === "active");
    const medCard = document.createElement("div");
    medCard.className = "stat-card c-mint";
    medCard.innerHTML = `<h3>Active Medications</h3><div class="stat-big">${activeMeds.length}</div>`;
    if (activeMeds.length) {
      const ul = document.createElement("ul"); ul.className = "stat-list";
      activeMeds.slice(0, 5).forEach(m => { ul.innerHTML += `<li><span>${m.name}</span><span class="field-value">${m.dosage || "—"}</span></li>`; });
      medCard.appendChild(ul);
    }
    grid.appendChild(medCard);

    const flaggedTests = forActiveProfile("tests").filter(t => t.flag === "high" || t.flag === "low")
      .sort((a, b) => new Date(b.dateResult || 0) - new Date(a.dateResult || 0));
    const testCardEl = document.createElement("div");
    testCardEl.className = "stat-card c-sky";
    testCardEl.innerHTML = `<h3>Abnormal Results</h3><div class="stat-big">${flaggedTests.length}</div>`;
    if (flaggedTests.length) {
      const ul = document.createElement("ul"); ul.className = "stat-list";
      flaggedTests.slice(0, 5).forEach(t => { ul.innerHTML += `<li><span>${t.testName}</span><span class="field-value" style="color:#D45B45">${t.value} ${t.unit || ""} (${t.flag})</span></li>`; });
      testCardEl.appendChild(ul);
    }
    grid.appendChild(testCardEl);

    const recentVital = [...forActiveProfile("vitals")].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];
    const vitalCardEl = document.createElement("div");
    vitalCardEl.className = "stat-card c-peach";
    vitalCardEl.innerHTML = `<h3>Most Recent Vitals</h3>`;
    if (recentVital) {
      vitalCardEl.innerHTML += `<ul class="stat-list">
        <li><span>Date</span><span class="field-value">${fmtDate(recentVital.date)}</span></li>
        <li><span>BP</span><span class="field-value">${recentVital.bp || "—"}</span></li>
        <li><span>Weight</span><span class="field-value">${recentVital.weight || "—"}</span></li>
        <li><span>Pulse</span><span class="field-value">${recentVital.pulse || "—"}</span></li>
        <li><span>Sugar</span><span class="field-value">${recentVital.sugar || "—"}</span></li>
      </ul>`;
    } else {
      vitalCardEl.innerHTML += `<div class="stat-big" style="font-size:16px;color:var(--ink-soft)">No vitals logged</div>`;
    }
    grid.appendChild(vitalCardEl);

    sheet.appendChild(grid);

    const reviewN = needsReviewCount();
    if (reviewN > 0) {
      const notice = document.createElement("div");
      notice.className = "record-card flagged";
      notice.innerHTML = `<div class="record-top"><div>
          <div class="record-name">✦ ${reviewN} ${reviewN === 1 ? "entry needs" : "entries need"} review</div>
          <div class="record-meta">Fields Claude couldn't confidently read are flagged, not guessed.</div>
        </div><button class="add-btn" onclick="window.__setView('review')">Review now</button></div>`;
      sheet.appendChild(notice);
    }

    const allergies = forActiveProfile("allergies") || [];
    if (state.allergies && state.allergies.filter(a => a.profileId === activeProfileId).length) {
      const list = state.allergies.filter(a => a.profileId === activeProfileId);
      const allergyCard = document.createElement("div");
      allergyCard.className = "record-card cat-diag abnormal";
      allergyCard.innerHTML = `<div class="record-name">Allergies &amp; Precautions</div>
        <div class="record-fields">${list.map(a => `<div class="field"><div class="field-label">${a.substance}</div><div class="field-value">${a.reaction}</div></div>`).join("")}</div>`;
      sheet.appendChild(allergyCard);
    }

    if (collectAll().length === 0 && forActiveProfile("symptoms").length === 0) {
      sheet.appendChild(emptyState("No health records yet for " + (p ? p.name : "this profile"),
        "Upload a prescription or lab report, or add an entry by hand, to start building this chart."));
    }
  }

  /* ---------- Inference tab: date-wise gist of tests, meds, symptoms ---------- */
  function renderInference() {
    const sheet = document.getElementById("sheet");
    const p = activeProfile();
    sheet.appendChild(header("Inference", `Date-wise gist of medications, tests & symptoms for ${p ? p.name : "this profile"}`));

    const note = document.createElement("div");
    note.className = "inference-disclaimer";
    note.textContent = "This is a plain organizational digest — medications started/stopped, test results as recorded, and symptoms as logged — grouped by date. It is not a medical interpretation. Please consult a healthcare professional for that.";
    sheet.appendChild(note);

    const items = [];
    forActiveProfile("medications").forEach(m => {
      if (m.startDate && m.startDate !== "Not mentioned") items.push({ date: m.startDate, tag: "med", text: `Started ${m.name}${m.dosage ? " — " + m.dosage : ""}${m.frequency ? ", " + m.frequency : ""}` });
      if (m.endDate && m.endDate !== "Not mentioned") items.push({ date: m.endDate, tag: "med", text: `Stopped ${m.name}` });
    });
    forActiveProfile("tests").forEach(t => {
      const d = t.dateResult && t.dateResult !== "Not mentioned" ? t.dateResult : t.dateOrdered;
      if (d && d !== "Not mentioned") items.push({ date: d, tag: "test", text: `${t.testName}: ${t.value || "pending"}${t.unit ? " " + t.unit : ""}${t.flag && t.flag !== "normal" && t.flag !== "not-mentioned" ? " (" + t.flag + ")" : ""}` });
    });
    forActiveProfile("symptoms").forEach(s => {
      if (s.date && s.date !== "Not mentioned") items.push({ date: s.date, tag: "symptom", text: `${s.symptoms} — ${s.severity || "severity not set"}` });
    });

    if (!items.length) {
      sheet.appendChild(emptyState("Nothing to summarize yet", "Once medications, tests, or symptoms have dates attached, they'll be grouped here day by day."));
      return;
    }

    const byDate = {};
    items.forEach(i => { const key = fmtDate(i.date); (byDate[key] = byDate[key] || []).push(i); });
    const sortedDates = Object.keys(byDate).sort((a, b) => new Date(b) - new Date(a));

    sortedDates.forEach(dateLabel => {
      const day = document.createElement("div");
      day.className = "inf-day";
      day.innerHTML = `<div class="inf-day-label">${dateLabel} <span class="pill">${byDate[dateLabel].length} entr${byDate[dateLabel].length === 1 ? "y" : "ies"}</span></div>`;
      const list = document.createElement("div");
      list.className = "inf-items";
      byDate[dateLabel].forEach(i => {
        const row = document.createElement("div");
        row.className = "inf-item";
        row.innerHTML = `<span class="inf-tag ${i.tag}">${i.tag}</span><span>${i.text}</span>`;
        list.appendChild(row);
      });
      day.appendChild(list);
      sheet.appendChild(day);
    });
  }

  /* ---------- Category views ---------- */
  const addLabels = {
    medications: "+ Add medication", tests: "+ Add test", diagnoses: "+ Add diagnosis",
    vitals: "+ Add vitals", visits: "+ Add visit", symptoms: "+ Add symptom entry",
  };

  function renderCategory(key, title, cardFn, catClass) {
    const sheet = document.getElementById("sheet");
    const records = forActiveProfile(key);
    const uploadableCategories = ["medications", "tests", "diagnoses", "visits", "vitals"];
    const extraBtn = uploadableCategories.includes(key) ? { label: "⤴ Upload document", onClick: () => triggerUpload(key) } : null;
    sheet.appendChild(header(title, `${records.length} entr${records.length === 1 ? "y" : "ies"}`, addLabels[key], () => openForm(key), extraBtn));

    if (!records.length) {
      sheet.appendChild(emptyState(`No ${title.toLowerCase()} yet`, "Upload a prescription/report above, or add an entry by hand — either way it'll show up here."));
      return;
    }
    const list = document.createElement("div");
    list.className = "record-list";
    const sorted = [...records].sort((a, b) => new Date(b.startDate || b.dateResult || b.dateNoted || b.date || 0) - new Date(a.startDate || a.dateResult || a.dateNoted || a.date || 0));
    sorted.forEach(r => list.appendChild(cardFn(r, catClass)));
    sheet.appendChild(list);
  }

  function cardShell(rec, name, metaHtml, pillHtml, fieldsHtml, key, catClass) {
    const hasUnclear = (rec.unclearFields || []).length > 0;
    const div = document.createElement("div");
    div.className = "record-card " + (catClass || "") + (hasUnclear ? " flagged" : "");
    div.innerHTML = `
      <div class="record-top">
        <div><div class="record-name">${name}</div><div class="record-meta">${metaHtml}</div></div>
        <div>${pillHtml}</div>
      </div>
      <div class="record-fields">${fieldsHtml}</div>
      <div class="source-tag">Source: ${rec.sourceDoc || "User entry"} ${rec.sourceDate ? "· " + fmtDate(rec.sourceDate) : ""}</div>
      ${(rec.history && rec.history.length) ? `<div class="history-note">✓ ${rec.history[rec.history.length - 1].note || "Corrected by you on " + fmtDate(rec.history[rec.history.length - 1].date)}</div>` : ""}
      <div class="record-actions">
        <button class="link-btn" data-act="edit">Correct this entry</button>
        <button class="link-btn danger" data-act="delete">Delete</button>
      </div>`;
    div.querySelector('[data-act="edit"]').onclick = () => openForm(key, rec);
    div.querySelector('[data-act="delete"]').onclick = () => {
      if (confirm("Remove this entry from the chart? This cannot be undone.")) {
        state[key] = state[key].filter(x => x.id !== rec.id);
        saveState(); render();
      }
    };
    return div;
  }

  function field(label, value) {
    return `<div class="field"><div class="field-label">${label}</div><div class="field-value ${fieldClass(value)}">${value || "Not mentioned"}</div></div>`;
  }

  function medicationCard(m, c) {
    return cardShell(m, m.name, `${m.dosage || "Not mentioned"} · ${m.frequency || "Not mentioned"}`,
      `<span class="pill pill-${m.status === "active" ? "active" : "discontinued"}">${m.status}</span>`,
      field("Route", m.route) + field("Duration", m.duration) + field("Start", fmtDate(m.startDate)) +
      field("End", m.endDate ? fmtDate(m.endDate) : "Not mentioned") + field("Prescribing doctor", m.prescribingDoctor),
      "medications", c);
  }
  function testCard(t, c) {
    return cardShell(t, t.testName, `${t.category || "Not mentioned"} · ordered ${fmtDate(t.dateOrdered)}`,
      `<span class="pill pill-${t.flag || "normal"}">${t.flag || "not mentioned"}</span>`,
      field("Result", t.value) + field("Unit", t.unit) + field("Reference range", t.referenceRange) +
      field("Result date", fmtDate(t.dateResult)) + field("Reason ordered", t.reasonOrdered),
      "tests", c);
  }
  function diagnosisCard(d, c) {
    return cardShell(d, d.condition, `Noted ${fmtDate(d.dateNoted)} · ${d.doctor || "Not mentioned"}`, "", field("Notes", d.notes), "diagnoses", c);
  }
  function vitalCard(v, c) {
    return cardShell(v, "Vitals — " + fmtDate(v.date), v.other || "", "",
      field("BP", v.bp) + field("Weight", v.weight) + field("Temperature", v.temperature) + field("Pulse", v.pulse) + field("Sugar", v.sugar),
      "vitals", c);
  }
  function visitCard(v, c) {
    return cardShell(v, v.clinic || v.doctor || "Visit", `${fmtDate(v.date)} · ${v.doctor || "Not mentioned"}`, "",
      field("Reason", v.reason) + field("Follow-up", v.followUp) + field("Remarks", v.remarks), "visits", c);
  }
  function symptomCard(s, c) {
    return cardShell(s, s.symptoms, fmtDate(s.date), `<span class="pill pill-${s.severity || "mild"}">${s.severity || "not set"}</span>`,
      field("Notes", s.notes), "symptoms", c);
  }

  /* ---------- Timeline ---------- */
  function renderTimeline() {
    const sheet = document.getElementById("sheet");
    sheet.appendChild(header("Combined Timeline", "Symptoms, prescriptions, tests and visits merged chronologically"));
    const items = [];
    forActiveProfile("medications").forEach(m => items.push({ date: m.startDate, kind: "med", label: `Started ${m.name}${m.dosage ? " — " + m.dosage : ""}` }));
    forActiveProfile("tests").forEach(t => items.push({ date: t.dateResult || t.dateOrdered, kind: "test", label: `${t.testName}: ${t.value || "pending"} ${t.unit || ""}${t.flag && t.flag !== "normal" ? " (" + t.flag + ")" : ""}` }));
    forActiveProfile("diagnoses").forEach(d => items.push({ date: d.dateNoted, kind: "diagnosis", label: `Diagnosed: ${d.condition}` }));
    forActiveProfile("visits").forEach(v => items.push({ date: v.date, kind: "visit", label: `Visit — ${v.doctor || "Not mentioned"} (${v.reason || "Not mentioned"})` }));
    forActiveProfile("symptoms").forEach(s => items.push({ date: s.date, kind: "symptom", label: `${s.symptoms} — ${s.severity}` }));

    const valid = items.filter(i => i.date && i.date !== "Not mentioned").sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!valid.length) {
      sheet.appendChild(emptyState("Nothing to show yet", "Once entries have dates, they'll line up here so you can cross-reference symptoms against medication and test changes."));
      return;
    }
    const tl = document.createElement("div"); tl.className = "timeline";
    valid.forEach(i => {
      const item = document.createElement("div"); item.className = "tl-item";
      item.innerHTML = `<div class="tl-dot ${i.kind}"></div><div class="tl-date">${fmtDate(i.date)}</div><div class="tl-body"><span class="tl-kind">${i.kind}</span>${i.label}</div>`;
      tl.appendChild(item);
    });
    sheet.appendChild(tl);
  }

  /* ---------- Review view ---------- */
  function renderReview() {
    const sheet = document.getElementById("sheet");
    const flagged = collectAll().filter(r => (r.unclearFields || []).length > 0);
    sheet.appendChild(header("Needs Review", `${flagged.length} entr${flagged.length === 1 ? "y" : "ies"} with fields Claude couldn't confidently read`));
    if (!flagged.length) { sheet.appendChild(emptyState("Nothing flagged", "When Claude extracts a document, anything unclear will show up here instead of a guessed value.")); return; }
    const list = document.createElement("div"); list.className = "record-list";
    flagged.forEach(r => {
      const div = document.createElement("div"); div.className = "record-card flagged";
      div.innerHTML = `<div class="record-top"><div class="record-name">${r.name || r.testName || r.condition || r.symptoms || "Entry"}</div><span class="pill pill-unclear">${r._type}</span></div>
        <div class="record-meta">Unclear fields: ${(r.unclearFields || []).join(", ")}</div>
        <div class="record-meta">Source: ${r.sourceDoc || "—"} ${r.sourceDate ? "· " + fmtDate(r.sourceDate) : ""}</div>
        <div class="record-actions"><button class="link-btn" data-act="fix">Correct this entry</button></div>`;
      div.querySelector('[data-act="fix"]').onclick = () => openForm(r._type + "s", r);
      list.appendChild(div);
    });
    sheet.appendChild(list);
  }

  /* ---------- Form / modal ---------- */
  const fieldDefs = {
    medications: [["name","Medication name","text"],["dosage","Dosage","text"],["frequency","Frequency","text"],
      ["route","Route","text"],["duration","Duration","text"],["startDate","Start date","date"],["endDate","End date","date"],
      ["status","Status","select",["active","discontinued"]],["prescribingDoctor","Prescribing doctor","text"],
      ["sourceDoc","Source document","text"],["sourceDate","Source date","date"]],
    tests: [["testName","Test name","text"],["category","Category","select",["Blood","Imaging","Urine","Other"]],
      ["reasonOrdered","Reason ordered","text"],["dateOrdered","Date ordered","date"],["dateResult","Result date","date"],
      ["value","Result value","text"],["unit","Unit","text"],["referenceRange","Reference range","text"],
      ["flag","Flag","select",["normal","high","low","not-mentioned"]],["sourceDoc","Source document","text"],["sourceDate","Source date","date"]],
    diagnoses: [["condition","Condition / diagnosis","text"],["dateNoted","Date noted","date"],["doctor","Doctor","text"],
      ["notes","Notes","textarea"],["sourceDoc","Source document","text"],["sourceDate","Source date","date"]],
    vitals: [["date","Date","date"],["bp","Blood pressure","text"],["weight","Weight","text"],["temperature","Temperature","text"],
      ["pulse","Pulse","text"],["sugar","Sugar level","text"],["other","Other","text"],["sourceDoc","Source document","text"],["sourceDate","Source date","date"]],
    visits: [["date","Date","date"],["doctor","Doctor","text"],["clinic","Clinic","text"],["reason","Reason","text"],
      ["followUp","Follow-up instructions","text"],["remarks","Doctor's remarks","textarea"],["sourceDoc","Source document","text"],["sourceDate","Source date","date"]],
    symptoms: [["date","Date","date"],["symptoms","Symptom(s)","text"],["severity","Severity","select",["mild","moderate","severe"]],["notes","Notes","textarea"]],
  };
  const titles = { medications: "Medication", tests: "Test", diagnoses: "Diagnosis", vitals: "Vitals entry", visits: "Visit", symptoms: "Symptom entry" };

  function openForm(key, existing) {
    const defs = fieldDefs[key];
    const modal = document.getElementById("modal");
    const isEdit = !!existing;
    modal.innerHTML = `
      <h2>${isEdit ? "Correct" : "Add"} ${titles[key]}</h2>
      <div class="modal-sub">${isEdit ? "Editing replaces the flagged/incorrect value and logs an audit note." : `New manual entry for ${activeProfile() ? activeProfile().name : "this profile"} — tagged as your input, not extracted.`}</div>
      <form id="entryForm"></form>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn" type="button">Cancel</button>
        <button class="btn-primary" id="saveBtn" type="button">${isEdit ? "Save correction" : "Add entry"}</button>
      </div>`;
    const form = modal.querySelector("#entryForm");
    defs.forEach(([name, label, type, options]) => {
      const row = document.createElement("div"); row.className = "form-row";
      const val = existing ? (isUnclear(existing[name]) || isMissing(existing[name]) ? "" : existing[name]) : "";
      if (type === "select") row.innerHTML = `<label>${label}</label><select name="${name}">${options.map(o => `<option value="${o}" ${val === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
      else if (type === "textarea") row.innerHTML = `<label>${label}</label><textarea name="${name}">${val || ""}</textarea>`;
      else row.innerHTML = `<label>${label}</label><input type="${type}" name="${name}" value="${val || ""}">`;
      form.appendChild(row);
    });
    modal.querySelector("#cancelBtn").onclick = closeModal;
    modal.querySelector("#saveBtn").onclick = () => {
      const fd = new FormData(form);
      const rec = existing ? { ...existing } : { id: uid(key), history: [], unclearFields: [], profileId: activeProfileId };
      let corrected = [];
      defs.forEach(([name]) => {
        const newVal = fd.get(name);
        if (newVal && newVal.trim() !== "") {
          if (existing && (isUnclear(existing[name]) || isMissing(existing[name])) && existing[name] !== newVal) corrected.push(name);
          rec[name] = newVal.trim();
          rec.unclearFields = (rec.unclearFields || []).filter(f => f !== name);
        } else if (!existing || !rec[name]) rec[name] = "Not mentioned";
      });
      if (key === "medications" && !rec.status) rec.status = "active";
      if (!rec.sourceDoc && key === "symptoms") rec.sourceDoc = "User entry";
      if (!rec.profileId) rec.profileId = activeProfileId;
      if (isEdit && corrected.length) {
        rec.history = rec.history || [];
        rec.history.push({ date: new Date().toISOString(), action: "corrected", by: "user", note: `Corrected ${corrected.join(", ")} by you on ${fmtDate(new Date().toISOString())}` });
      }
      if (isEdit) state[key] = state[key].map(x => x.id === rec.id ? rec : x);
      else state[key].push(rec);
      saveState(); closeModal(); render();
    };
    document.getElementById("modalBackdrop").classList.add("open");
  }

  function closeModal() { document.getElementById("modalBackdrop").classList.remove("open"); }

  /* ---------- Documents view ---------- */
  let pendingUploadCategory = null;

  function renderDocuments() {
    const sheet = document.getElementById("sheet");
    const docs = forActiveProfile("sourceDocuments");
    sheet.appendChild(header("Documents", `${docs.length} uploaded · ${pendingDocsCount()} awaiting extraction`));

    const dz = document.createElement("div"); dz.className = "dropzone";
    dz.innerHTML = `<div class="dropzone-icon">⤴</div><div class="dropzone-title">Upload a prescription, lab report, or any file</div><div class="dropzone-sub">Click to browse, or drag a file here — image, PDF, or document</div>`;
    dz.onclick = () => triggerUpload(null);
    dz.ondragover = e => { e.preventDefault(); dz.classList.add("drag"); };
    dz.ondragleave = () => dz.classList.remove("drag");
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], null); };
    sheet.appendChild(dz);

    const note = document.createElement("div"); note.className = "record-card"; note.style.marginBottom = "18px";
    note.innerHTML = `<div class="record-meta" style="font-size:12px;line-height:1.6;">
      Uploading stores the file in your GitHub repo and adds it to this profile's queue. It does <b>not</b> get read automatically —
      bring it to Claude in chat ("extract the file I just uploaded") to have it turned into structured entries under the strict
      no-hallucination rules, then use <b>Import data</b> to bring the result in. That import can automatically mark the matching
      document below as extracted.</div>`;
    sheet.appendChild(note);

    if (!docs.length) { sheet.appendChild(emptyState("No documents yet", "Uploaded files will be listed here with their extraction status.")); return; }

    const list = document.createElement("div"); list.className = "doc-list";
    [...docs].sort((a, b) => new Date(b.uploadDate || 0) - new Date(a.uploadDate || 0)).forEach(d => {
      const card = document.createElement("div"); card.className = "doc-card";
      const ext = (d.filename.split(".").pop() || "").toUpperCase();
      card.innerHTML = `
        <div class="doc-icon">${ext.slice(0, 4)}</div>
        <div class="doc-info"><div class="doc-name">${d.filename}</div>
          <div class="doc-meta">Uploaded ${fmtDate(d.uploadDate)}${d.category ? " · tagged for " + d.category : ""}</div></div>
        <span class="pill pill-${d.status}">${d.status}</span>
        <a class="link-btn" href="${d.rawUrl || "#"}" target="_blank" rel="noopener" style="margin-left:10px;">View</a>
        <button class="link-btn danger" style="margin-left:10px;" data-act="remove">Remove</button>`;
      card.querySelector('[data-act="remove"]').onclick = () => {
        if (confirm("Remove this document from the queue? The file stays in your GitHub repo, only the reference here is removed.")) {
          state.sourceDocuments = state.sourceDocuments.filter(x => x.id !== d.id);
          saveState(); render();
        }
      };
      list.appendChild(card);
    });
    sheet.appendChild(list);
  }

  function triggerUpload(category) {
    if (!ghConfig) { alert("Connect GitHub first (side rail) — uploaded files are stored in your repo."); return; }
    if (!activeProfileId) { alert("Choose or add a profile first."); return; }
    pendingUploadCategory = category;
    document.getElementById("fileInput").click();
  }

  document.getElementById("fileInput").addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0], pendingUploadCategory);
    e.target.value = "";
  });

  async function handleFile(file, category) {
    if (!ghConfig) { alert("Connect GitHub first."); return; }
    setSyncStatus("Uploading " + file.name + "…");
    try {
      const buf = await file.arrayBuffer();
      let binary = ""; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      const safeName = Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const uploadPath = `uploads/${safeName}`;
      const res = await fetch(ghApiUrl(uploadPath), {
        method: "PUT",
        headers: { Authorization: `Bearer ${ghConfig.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Upload document: ${file.name}`, content: b64, branch: ghConfig.branch || "main" }),
      });
      if (!res.ok) { const errBody = await res.json().catch(() => ({})); throw new Error(errBody.message || `GitHub responded ${res.status}`); }
      const json = await res.json();
      const doc = {
        id: uid("doc"), filename: file.name, uploadDate: new Date().toISOString(),
        category: category || null, status: "pending", path: uploadPath, rawUrl: json.content.download_url,
        profileId: activeProfileId,
      };
      state.sourceDocuments = state.sourceDocuments || [];
      state.sourceDocuments.push(doc);
      await saveState();
      currentView = "documents";
      render();
    } catch (e) {
      setSyncStatus("Upload failed: " + e.message, "err");
      console.error(e);
    }
  }

  /* ---------- Export / Import ---------- */
  function exportChart() { window.print(); }

  function importData() {
    const modal = document.getElementById("modal");
    modal.innerHTML = `
      <h2>Import data</h2>
      <div class="modal-sub">Paste a JSON health-record object (as produced by Claude after extracting a document) to merge it into ${activeProfile() ? activeProfile().name : "this profile"}'s chart.</div>
      <div class="form-row"><label>Which document was this extracted from? (optional)</label>
        <select id="importSourceDoc"><option value="">— none / not from an upload —</option>
          ${forActiveProfile("sourceDocuments").filter(d => d.status === "pending").map(d => `<option value="${d.id}">${d.filename}</option>`).join("")}
        </select></div>
      <div class="form-row"><textarea id="importArea" style="min-height:200px;font-family:var(--mono);font-size:12px;" placeholder='{"medications":[...],"tests":[...]}'></textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelBtn" type="button">Cancel</button>
        <button class="btn-primary" id="mergeBtn" type="button">Merge into chart</button>
      </div>`;
    modal.querySelector("#cancelBtn").onclick = closeModal;
    modal.querySelector("#mergeBtn").onclick = () => {
      try {
        const incoming = JSON.parse(document.getElementById("importArea").value);
        const linkedDocId = document.getElementById("importSourceDoc").value;
        ["medications", "tests", "diagnoses", "vitals", "visits", "symptoms", "allergies", "sourceDocuments"].forEach(key => {
          if (Array.isArray(incoming[key])) {
            incoming[key].forEach(rec => { if (!rec.id) rec.id = uid(key); if (!rec.profileId) rec.profileId = activeProfileId; });
            state[key] = [...state[key], ...incoming[key]];
          }
        });
        if (linkedDocId) state.sourceDocuments = (state.sourceDocuments || []).map(d => d.id === linkedDocId ? { ...d, status: "extracted" } : d);
        saveState(); closeModal(); render();
      } catch (e) {
        alert("That didn't parse as valid JSON. Ask Claude to re-export the extracted data block and paste it in again.");
      }
    };
    document.getElementById("modalBackdrop").classList.add("open");
  }

  /* ---------- Connect GitHub ---------- */
  function openConnect() {
    const modal = document.getElementById("modal");
    const c = ghConfig || {};
    modal.innerHTML = `
      <h2>Connect GitHub</h2>
      <div class="modal-sub">Reads and writes data.json in your repo, so the chart is the same on every device that connects with this info.</div>
      <div class="form-row"><label>Repo owner (your GitHub username)</label><input type="text" id="ghOwner" value="${c.owner || ""}" placeholder="e.g. janedoe"></div>
      <div class="form-row"><label>Repository name</label><input type="text" id="ghRepo" value="${c.repo || ""}" placeholder="e.g. health-chart"></div>
      <div class="form-row"><label>Branch</label><input type="text" id="ghBranch" value="${c.branch || "main"}"></div>
      <div class="form-row"><label>Data file path</label><input type="text" id="ghPath" value="${c.path || "data.json"}"></div>
      <div class="form-row"><label>Personal access token</label><input type="password" id="ghToken" value="${c.token || ""}" placeholder="fine-grained PAT, Contents: Read & write"></div>
      <div class="modal-sub" style="margin-top:-6px;">Create one at GitHub → Settings → Developer settings → Fine-grained tokens. Scope it to just this repo with Contents: Read and write. The token is stored only in this browser's localStorage.</div>
      <div class="modal-actions">
        ${c.owner ? `<button class="link-btn danger" id="disconnectBtn" type="button" style="margin-right:auto;">Disconnect</button>` : ""}
        <button class="btn-secondary" id="cancelBtn" type="button">Cancel</button>
        <button class="btn-primary" id="connectSaveBtn" type="button">Save &amp; sync</button>
      </div>`;
    modal.querySelector("#cancelBtn").onclick = closeModal;
    const dc = modal.querySelector("#disconnectBtn");
    if (dc) dc.onclick = () => { clearGhConfig(); ghFileSha = null; setSyncStatus("Not connected to GitHub"); closeModal(); };
    modal.querySelector("#connectSaveBtn").onclick = async () => {
      const cfg = {
        owner: modal.querySelector("#ghOwner").value.trim(), repo: modal.querySelector("#ghRepo").value.trim(),
        branch: modal.querySelector("#ghBranch").value.trim() || "main", path: modal.querySelector("#ghPath").value.trim() || "data.json",
        token: modal.querySelector("#ghToken").value.trim(),
      };
      if (!cfg.owner || !cfg.repo || !cfg.token) { alert("Owner, repo, and token are required."); return; }
      saveGhConfig(cfg); closeModal(); await fetchFromGithub();
    };
    document.getElementById("modalBackdrop").classList.add("open");
  }

  /* ---------- Wiring ---------- */
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => { currentView = t.dataset.view; render(); }));
  document.getElementById("exportBtn").addEventListener("click", exportChart);
  document.getElementById("importBtn").addEventListener("click", importData);
  document.getElementById("connectBtn").addEventListener("click", openConnect);
  document.getElementById("modalBackdrop").addEventListener("click", e => { if (e.target.id === "modalBackdrop") closeModal(); });
  document.getElementById("profileBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleProfileMenu(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".profile-fab-wrap") && !e.target.closest("#profileMenu")) closeProfileMenu(); });
  window.addEventListener("resize", () => { if (document.getElementById("profileMenu").classList.contains("open")) openProfileMenu(); });
  window.__setView = (v) => { currentView = v; render(); };

  ensureProfiles();
  render();
  if (ghConfig) fetchFromGithub(); else setSyncStatus("Not connected to GitHub");
})();
