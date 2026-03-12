// === State ===
const state = {
  householdId: localStorage.getItem("household_id"),
  shareCode: localStorage.getItem("share_code"),
  familyName: localStorage.getItem("family_name") || "",
  members: JSON.parse(localStorage.getItem("members") || "[]"),
  currentListId: null,
  currentListCategory: null,
  lists: [],
  categories: [],
  items: [],
  notes: [],
  currentNoteId: null,
  selectedEmoji: "\u{1F6D2}",
  selectedCategory: "Einkauf",
  pollTimer: null,
  lastTs: 0,
};

const LIST_EMOJIS = [
  "\u{1F6D2}", "\u{1F34E}", "\u{1F969}", "\u{1F35E}", "\u{1F9C0}",
  "\u{1F37A}", "\u{1F484}", "\u{1F9F9}", "\u{1F33B}", "\u{1F527}",
  "\u{1F48A}", "\u{1F4C5}", "\u{1F436}", "\u{1F381}", "\u{2708}\u{FE0F}",
  "\u{2705}", "\u{1F3E0}", "\u{1F4DD}", "\u{1F4A1}", "\u{2B50}",
];

const CATEGORY_ICONS = {
  "Einkauf": "\u{1F6D2}",
  "Aufgaben": "\u{2705}",
  "Termine": "\u{1F4C5}",
  "Wuensche": "\u{1F381}",
  "Garten": "\u{1F33B}",
  "Reparaturen": "\u{1F527}",
};

const DEFAULT_CATEGORIES = ["Einkauf", "Aufgaben", "Termine", "Wuensche", "Garten", "Reparaturen"];

// Categories that show assignment picker
const ASSIGNABLE_CATEGORIES = ["Aufgaben", "Einkauf"];
// Categories that show date/time picker
const DATE_CATEGORIES = ["Termine", "Aufgaben"];
// Categories that show recurrence picker
const RECURRENCE_CATEGORIES = ["Termine"];
// Wishlist: items are per-person, others can see what to gift
const WISHLIST_CATEGORY = "Wuensche";

// === API Helper ===
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(state.householdId ? { "X-Household-Id": state.householdId } : {}),
  };

  try {
    const res = await fetch(`/api/${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return await res.json();
  } catch {
    return { error: "Verbindungsfehler" };
  }
}

// === Views ===
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${id}`).classList.remove("hidden");
}

function showModal(id) {
  document.getElementById(`modal-${id}`).classList.remove("hidden");
}

function hideModal(id) {
  document.getElementById(`modal-${id}`).classList.add("hidden");
}

function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

// === Welcome / Household ===
async function createHousehold() {
  const familyNameInput = document.getElementById("input-family-name");
  const familyName = familyNameInput.value.trim();

  if (!familyName) {
    familyNameInput.focus();
    showToast("Bitte Familienname eingeben!");
    return;
  }

  const displayName = familyName + "'s Familienorga";

  const data = await api("household", {
    method: "POST",
    body: { action: "create", name: displayName },
  });

  if (data.error) {
    showToast(data.error);
    return;
  }

  state.householdId = data.id;
  state.shareCode = data.shareCode;
  state.familyName = displayName;
  localStorage.setItem("household_id", data.id);
  localStorage.setItem("share_code", data.shareCode);
  localStorage.setItem("family_name", displayName);

  document.getElementById("share-code-display").textContent = data.shareCode;
  showView("share");
}

async function joinHousehold() {
  const input = document.getElementById("input-code");
  const code = input.value.trim();

  if (code.length < 4) {
    document.getElementById("join-error").textContent =
      "Bitte gib einen gueltigen Code ein.";
    return;
  }

  const data = await api("household", {
    method: "POST",
    body: { action: "join", code },
  });

  if (data.error) {
    document.getElementById("join-error").textContent = data.error;
    return;
  }

  state.householdId = data.id;
  state.shareCode = data.shareCode;
  state.familyName = data.name || "";
  localStorage.setItem("household_id", data.id);
  localStorage.setItem("share_code", data.shareCode);
  localStorage.setItem("family_name", data.name || "");

  showToast("Erfolgreich beigetreten!");
  await loadMembers();
  loadLists();
  // Pre-load travel subtitle for main page card
  setTimeout(updateTravelSubtitle, 500);
}

// === Lists ===
async function loadLists() {
  showView("lists");

  const data = await api("lists");
  if (data.error) {
    if (data.error === "Household-ID fehlt") {
      leaveHousehold();
      return;
    }
    showToast(data.error);
    return;
  }

  state.lists = data.lists || [];
  state.categories = data.categories || [];

  // Merge default categories with server categories
  const allCats = [...new Set([...DEFAULT_CATEGORIES, ...state.categories])];
  state.categories = allCats;

  renderLists();
}

function renderLists() {
  const container = document.getElementById("lists-container");

  // Group lists by category
  const grouped = {};
  for (const cat of state.categories) {
    grouped[cat] = state.lists.filter((l) => (l.category || "Einkauf") === cat);
  }

  // Also catch lists with unknown categories
  for (const list of state.lists) {
    const cat = list.category || "Einkauf";
    if (!grouped[cat]) {
      grouped[cat] = [];
      state.categories.push(cat);
    }
  }

  let html = "";

  // Special cards row: Notes, Calendar, Chat
  html += `
    <div class="special-cards-row">
      <div class="special-card" id="btn-open-notes">
        <span class="special-card-icon">\u{1F4DD}</span>
        <div class="special-card-text">
          <span class="special-card-title">Notizen</span>
          <span class="special-card-subtitle">Merkliste</span>
        </div>
      </div>
      <div class="special-card" id="btn-open-calendar">
        <span class="special-card-icon">\u{1F4C5}</span>
        <div class="special-card-text">
          <span class="special-card-title">Kalender</span>
          <span class="special-card-subtitle">Termine</span>
        </div>
      </div>
      <div class="special-card" id="btn-open-travel">
        <span class="special-card-icon">\u{2708}\u{FE0F}</span>
        <div class="special-card-text">
          <span class="special-card-title">Reisen</span>
          <span class="special-card-subtitle" id="travel-card-subtitle">TripIt</span>
        </div>
      </div>
      <div class="special-card" id="btn-open-chat">
        <span class="special-card-icon">\u{1F916}</span>
        <div class="special-card-text">
          <span class="special-card-title">Assistent</span>
          <span class="special-card-subtitle">AI Chat</span>
        </div>
      </div>
    </div>
  `;

  for (const cat of state.categories) {
    const lists = grouped[cat] || [];
    const icon = CATEGORY_ICONS[cat] || "\u{1F4C1}";
    const totalOpen = lists.reduce((sum, l) => sum + (l.open_items || 0), 0);

    html += `
      <div class="category-header">
        <span class="category-header-icon">${icon}</span>
        <span class="category-header-name">${escapeHtml(cat)}</span>
        ${totalOpen > 0 ? `<span class="category-header-count">${totalOpen} offen</span>` : ""}
      </div>
    `;

    if (lists.length === 0) {
      html += `<div class="category-empty">Noch keine Listen</div>`;
    } else {
      for (const list of lists) {
        html += `
          <div class="list-card" data-id="${list.id}">
            <span class="list-card-emoji">${list.emoji}</span>
            <div class="list-card-info">
              <div class="list-card-name">${escapeHtml(list.name)}</div>
              <div class="list-card-count">${list.open_items} offen${list.total_items > 0 ? ` / ${list.total_items} gesamt` : ""}</div>
            </div>
            <span class="list-card-arrow">\u203A</span>
          </div>
        `;
      }
    }
  }

  container.innerHTML = html;

  container.querySelectorAll(".list-card").forEach((card) => {
    card.addEventListener("click", () => openList(card.dataset.id));
  });

  document.getElementById("btn-open-notes").addEventListener("click", openNotes);
  document.getElementById("btn-open-calendar").addEventListener("click", openCalendar);
  document.getElementById("btn-open-travel").addEventListener("click", openTravel);
  document.getElementById("btn-open-chat").addEventListener("click", openChat);
}

async function createList() {
  const nameInput = document.getElementById("input-list-name");
  const newCatInput = document.getElementById("input-new-category");
  const name = nameInput.value.trim();

  if (!name) {
    nameInput.focus();
    return;
  }

  // Determine category
  let category = state.selectedCategory;
  if (category === "__new__") {
    category = newCatInput.value.trim();
    if (!category) {
      newCatInput.focus();
      return;
    }
  }

  const data = await api("lists", {
    method: "POST",
    body: { name, emoji: state.selectedEmoji, category },
  });

  if (data.error) {
    showToast(data.error);
    return;
  }

  nameInput.value = "";
  newCatInput.value = "";
  hideModal("new-list");
  loadLists();
  showToast("Liste erstellt!");
}

async function deleteList() {
  if (!state.currentListId) return;

  const data = await api(`list/${state.currentListId}`, {
    method: "DELETE",
  });

  if (data.error) {
    showToast(data.error);
    return;
  }

  hideModal("delete-list");
  state.currentListId = null;
  stopPolling();
  loadLists();
  showToast("Liste geloescht.");
}

// === List Detail ===
async function openList(listId) {
  state.currentListId = listId;
  showView("detail");
  await fetchItems();
  startPolling();
}

async function fetchItems() {
  if (!state.currentListId) return;

  const data = await api(`list/${state.currentListId}`);
  if (data.error) {
    showToast(data.error);
    return;
  }

  // Only re-render if data actually changed
  if (data._ts !== state.lastTs) {
    state.lastTs = data._ts;
    state.items = data.items || [];
    state.currentListCategory = data.list.category || "Einkauf";

    const title = document.getElementById("detail-title");
    title.textContent = `${data.list.emoji} ${data.list.name}`;

    // Show/hide date/assignment fields based on category
    const cat = state.currentListCategory;
    const showDates = DATE_CATEGORIES.includes(cat);
    const showRecurrence = RECURRENCE_CATEGORIES.includes(cat);
    const showAssign = ASSIGNABLE_CATEGORIES.includes(cat);
    const isWishlist = cat === WISHLIST_CATEGORY;

    document.getElementById("add-item-date-row").classList.toggle("hidden", !showDates);
    document.getElementById("input-item-recurrence").classList.toggle("hidden", !showRecurrence);
    document.getElementById("add-item-assign-row").classList.toggle("hidden", !showAssign && !isWishlist);

    // Change label for wishlists
    const assignLabel = document.getElementById("assign-label");
    if (isWishlist) {
      assignLabel.textContent = "Wunsch von:";
      document.getElementById("input-new-item").placeholder = "Wunsch hinzufuegen...";
    } else if (cat === "Aufgaben") {
      assignLabel.textContent = "Fuer:";
      document.getElementById("input-new-item").placeholder = "Aufgabe hinzufuegen...";
    } else if (cat === "Termine") {
      assignLabel.textContent = "";
      document.getElementById("input-new-item").placeholder = "Termin hinzufuegen...";
    } else {
      assignLabel.textContent = "";
      document.getElementById("input-new-item").placeholder = "Artikel hinzufuegen...";
    }

    renderItems();
  }
}

function renderItems() {
  const container = document.getElementById("items-container");
  const emptyState = document.getElementById("empty-list");

  if (state.items.length === 0) {
    container.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");

  const cat = state.currentListCategory;
  const isWishlist = cat === WISHLIST_CATEGORY;
  let displayItems = state.items;

  // For wishlists: show own wishes and hide who wished what for others
  // (everyone sees all wishes but the "von" label helps know whose wish it is)

  const unchecked = displayItems.filter((i) => !i.checked);
  const checked = displayItems.filter((i) => i.checked);

  let html = unchecked.map((item) => renderItem(item)).join("");

  if (checked.length > 0) {
    const hint = isWishlist ? "— bereits erfuellt" : "— antippen zum Reaktivieren";
    html += `<div class="checked-divider">Erledigt (${checked.length}) <span class="checked-divider-hint">${hint}</span></div>`;
    html += checked.map((item) => renderItem(item)).join("");
  }

  container.innerHTML = html;

  // Attach event listeners
  container.querySelectorAll(".item-checkbox").forEach((cb) => {
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleItem(cb.closest(".item-card").dataset.id);
    });
  });

  container.querySelectorAll(".item-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteItem(btn.closest(".item-card").dataset.id);
    });
  });
}

const RECURRENCE_LABELS = {
  weekly: "Woechentlich",
  monthly: "Monatlich",
  yearly: "Jaehrlich",
};

function getMemberColor(name) {
  const member = state.members.find((m) => m.name === name);
  return member ? member.color : "#888";
}

function renderItem(item) {
  const cat = state.currentListCategory;
  const isTermine = cat === "Termine";
  const isAufgaben = cat === "Aufgaben";
  const isWishlist = cat === WISHLIST_CATEGORY;

  let dateStr = "";
  if (item.due_date) {
    const d = new Date(item.due_date + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    if (d.getTime() === today.getTime()) {
      dateStr = "Heute";
    } else if (d.getTime() === tomorrow.getTime()) {
      dateStr = "Morgen";
    } else {
      dateStr = `${dayNames[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
    }
    if (item.due_time) {
      dateStr += ` ${item.due_time}`;
    }
    // Check if overdue
    if (!item.checked && d < today) {
      dateStr = `\u26A0\uFE0F ${dateStr}`;
    }
  }

  const recLabel = item.recurrence ? RECURRENCE_LABELS[item.recurrence] || item.recurrence : "";

  // Assignment badge
  let assignBadge = "";
  if (item.assigned_to) {
    const color = getMemberColor(item.assigned_to);
    const initial = item.assigned_to.charAt(0).toUpperCase();
    if (isWishlist) {
      assignBadge = `<span class="assign-badge" style="background:${color}" title="Wunsch von ${escapeHtml(item.assigned_to)}">${initial}</span>`;
    } else {
      assignBadge = `<span class="assign-badge" style="background:${color}" title="${escapeHtml(item.assigned_to)}">${initial}</span>`;
    }
  }

  const cardClass = `item-card ${item.checked ? "checked" : ""} ${isTermine || isAufgaben ? "item-termin" : ""}`;
  const borderColor = item.assigned_to && (isAufgaben || isWishlist) ? `border-left-color:${getMemberColor(item.assigned_to)}` : "";

  return `
    <div class="${cardClass}" data-id="${item.id}" ${borderColor ? `style="${borderColor}"` : ""}>
      <div class="item-checkbox">${item.checked ? "\u2713" : ""}</div>
      <div class="item-info">
        <div class="item-name">${assignBadge}${escapeHtml(item.name)}</div>
        ${item.quantity ? `<div class="item-quantity">${escapeHtml(item.quantity)}</div>` : ""}
        ${dateStr ? `<div class="item-date">${dateStr}${recLabel ? ` &middot; \u{1F501} ${recLabel}` : ""}</div>` : ""}
        ${!dateStr && recLabel ? `<div class="item-date">\u{1F501} ${recLabel}</div>` : ""}
      </div>
      <button class="item-delete" title="Loeschen">\u00D7</button>
    </div>
  `;
}

async function addItem() {
  const input = document.getElementById("input-new-item");
  let text = input.value.trim();

  if (!text) return;

  const cat = state.currentListCategory;
  const showDates = DATE_CATEGORIES.includes(cat);
  const showAssign = ASSIGNABLE_CATEGORIES.includes(cat) || cat === WISHLIST_CATEGORY;

  let quantity = null;
  let due_date = null;
  let due_time = null;
  let recurrence = null;
  let assigned_to = null;

  if (showDates) {
    due_date = document.getElementById("input-item-date").value || null;
    due_time = document.getElementById("input-item-time").value || null;
    recurrence = document.getElementById("input-item-recurrence").value || null;
  }

  if (showAssign) {
    assigned_to = document.getElementById("input-item-assign").value || null;
  }

  if (!showDates) {
    // Parse quantity: "2x Milch" or "500g Mehl"
    const qMatch = text.match(/^(\d+[xX\u00D7]|\d+\s*(?:g|kg|ml|l|st|stk|pck|pkg))\s+/i);
    if (qMatch) {
      quantity = qMatch[1].trim();
      text = text.slice(qMatch[0].length);
    }
  }

  // Optimistic UI
  const tempId = "temp-" + Date.now();
  state.items.unshift({
    id: tempId,
    name: text,
    quantity,
    due_date,
    due_time,
    recurrence,
    assigned_to,
    checked: 0,
  });
  renderItems();
  input.value = "";
  if (showDates) {
    document.getElementById("input-item-date").value = "";
    document.getElementById("input-item-time").value = "";
    document.getElementById("input-item-recurrence").value = "";
  }
  input.focus();

  const data = await api(`item/${state.currentListId}`, {
    method: "POST",
    body: { name: text, quantity, due_date, due_time, recurrence, assigned_to },
  });

  if (data.error) {
    state.items = state.items.filter((i) => i.id !== tempId);
    renderItems();
    showToast(data.error);
    return;
  }

  // Replace temp item with real one
  const idx = state.items.findIndex((i) => i.id === tempId);
  if (idx >= 0) {
    state.items[idx] = { ...state.items[idx], id: data.id };
  }

  // Force refresh to sync
  state.lastTs = 0;
}

function getNextDate(dateStr, recurrence) {
  const d = new Date(dateStr + "T00:00:00");
  if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  else if (recurrence === "yearly") d.setFullYear(d.getFullYear() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function toggleItem(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const wasUnchecked = !item.checked;

  // Optimistic UI
  item.checked = item.checked ? 0 : 1;
  renderItems();

  // If checking a recurring item: advance to next date
  if (wasUnchecked && item.recurrence && item.due_date) {
    const nextDate = getNextDate(item.due_date, item.recurrence);
    const data = await api(`item/${itemId}`, {
      method: "PATCH",
      body: { checked: 0, due_date: nextDate },
    });
    if (!data.error) {
      item.checked = 0;
      item.due_date = nextDate;
      renderItems();
      showToast("Naechster Termin: " + nextDate.split("-").reverse().join("."));
    }
  } else {
    const data = await api(`item/${itemId}`, {
      method: "PATCH",
      body: { checked: item.checked },
    });

    if (data.error) {
      item.checked = item.checked ? 0 : 1;
      renderItems();
      showToast(data.error);
    }
  }

  state.lastTs = 0;
}

async function deleteItem(itemId) {
  // Optimistic UI
  const removed = state.items.find((i) => i.id === itemId);
  state.items = state.items.filter((i) => i.id !== itemId);
  renderItems();

  const data = await api(`item/${itemId}`, {
    method: "DELETE",
  });

  if (data.error) {
    if (removed) state.items.push(removed);
    renderItems();
    showToast(data.error);
  }

  state.lastTs = 0;
}

// === Notes ===
async function openNotes() {
  showView("notes");
  stopPolling();
  await loadNotes();
}

async function loadNotes() {
  const data = await api("notes");
  if (data.error) {
    showToast(data.error);
    return;
  }
  state.notes = data.notes || [];
  renderNotes();
}

function renderNotes() {
  const container = document.getElementById("notes-container");
  const emptyState = document.getElementById("empty-notes");

  if (state.notes.length === 0) {
    container.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");

  const pinned = state.notes.filter((n) => n.pinned);
  const unpinned = state.notes.filter((n) => !n.pinned);

  let html = "";
  if (pinned.length > 0) {
    html += `<div class="notes-section-label">\u{1F4CC} Angepinnt</div>`;
    html += pinned.map(renderNoteCard).join("");
  }
  if (unpinned.length > 0) {
    if (pinned.length > 0) html += `<div class="notes-section-label">Weitere</div>`;
    html += unpinned.map(renderNoteCard).join("");
  }

  container.innerHTML = html;

  container.querySelectorAll(".note-card").forEach((card) => {
    card.addEventListener("click", () => openNote(card.dataset.id));
  });
}

function renderNoteCard(note) {
  const preview = (note.content || "").slice(0, 80).replace(/\n/g, " ");
  const date = new Date(note.updated_at);
  const dateStr = `${date.getDate()}.${date.getMonth() + 1}.`;

  return `
    <div class="note-card ${note.pinned ? "note-pinned" : ""}" data-id="${note.id}">
      <div class="note-card-content">
        <div class="note-card-title">${note.pinned ? "\u{1F4CC} " : ""}${escapeHtml(note.title)}</div>
        ${preview ? `<div class="note-card-preview">${escapeHtml(preview)}</div>` : ""}
      </div>
      <div class="note-card-date">${dateStr}</div>
    </div>
  `;
}

async function createNote() {
  const titleInput = document.getElementById("input-note-title");
  const title = titleInput.value.trim();
  if (!title) { titleInput.focus(); return; }

  const data = await api("notes", {
    method: "POST",
    body: { title },
  });

  if (data.error) { showToast(data.error); return; }

  titleInput.value = "";
  hideModal("new-note");
  await loadNotes();
  openNote(data.id);
  showToast("Notiz erstellt!");
}

function openNote(noteId) {
  state.currentNoteId = noteId;
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return;

  showView("note-detail");
  document.getElementById("note-detail-title").textContent = note.title;
  const textarea = document.getElementById("note-content");
  textarea.value = note.content || "";
  textarea.focus();

  document.getElementById("btn-pin-note").textContent = note.pinned ? "\u{1F4CC} Angepinnt" : "\u{1F4CC} Anpinnen";
}

let noteSaveTimer = null;
function onNoteInput() {
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(saveNote, 800);
}

async function saveNote() {
  if (!state.currentNoteId) return;
  const content = document.getElementById("note-content").value;
  await api(`note/${state.currentNoteId}`, {
    method: "PATCH",
    body: { content },
  });
}

async function togglePinNote() {
  if (!state.currentNoteId) return;
  const note = state.notes.find((n) => n.id === state.currentNoteId);
  if (!note) return;

  const newPinned = note.pinned ? 0 : 1;
  await api(`note/${state.currentNoteId}`, {
    method: "PATCH",
    body: { pinned: newPinned },
  });
  note.pinned = newPinned;
  document.getElementById("btn-pin-note").textContent = newPinned ? "\u{1F4CC} Angepinnt" : "\u{1F4CC} Anpinnen";
  showToast(newPinned ? "Angepinnt!" : "Losgeloest!");
}

async function deleteNote() {
  if (!state.currentNoteId) return;
  await api(`note/${state.currentNoteId}`, { method: "DELETE" });
  hideModal("delete-note");
  state.currentNoteId = null;
  openNotes();
  showToast("Notiz geloescht.");
}

// === Members ===
async function loadMembers() {
  const data = await api("members");
  if (data.error) return;

  state.members = data.members || [];
  state.familyName = data.householdName || state.familyName;
  localStorage.setItem("members", JSON.stringify(state.members));
  localStorage.setItem("family_name", state.familyName);

  updateHeader();
  updateAssignPicker();
}

function updateHeader() {
  const headerEl = document.getElementById("header-title");
  if (headerEl) {
    const name = state.familyName || "Familienorga";
    headerEl.innerHTML = "\u{1F3E0} " + escapeHtml(name);
    document.title = name;
  }
}

function updateAssignPicker() {
  const select = document.getElementById("input-item-assign");
  if (!select) return;
  // Keep "Alle" option, replace rest
  select.innerHTML = '<option value="">Alle</option>';
  for (const m of state.members) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    select.appendChild(opt);
  }
}

function renderMembersList() {
  const container = document.getElementById("members-list");
  if (!container) return;

  if (state.members.length === 0) {
    container.innerHTML = '<div class="members-empty">Noch keine Mitglieder</div>';
    return;
  }

  container.innerHTML = state.members.map((m) => `
    <div class="member-chip" data-id="${m.id}">
      <span class="member-dot" style="background:${m.color}"></span>
      <span class="member-name">${escapeHtml(m.name)}</span>
      <button class="member-remove" data-id="${m.id}">\u00D7</button>
    </div>
  `).join("");

  container.querySelectorAll(".member-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await api(`members?id=${id}`, { method: "DELETE" });
      await loadMembers();
      renderMembersList();
      showToast("Mitglied entfernt.");
    });
  });
}

async function addMember() {
  const input = document.getElementById("input-new-member");
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const data = await api("members", {
    method: "POST",
    body: { name },
  });

  if (data.error) { showToast(data.error); return; }

  input.value = "";
  await loadMembers();
  renderMembersList();
  showToast(name + " hinzugefuegt!");
}

// === Polling ===
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(fetchItems, 3000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

// === Household Settings ===
function leaveHousehold() {
  stopPolling();
  localStorage.removeItem("household_id");
  localStorage.removeItem("share_code");
  localStorage.removeItem("family_name");
  localStorage.removeItem("members");
  state.householdId = null;
  state.shareCode = null;
  state.familyName = "";
  state.members = [];
  state.currentListId = null;
  showView("welcome");
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    showToast("Code kopiert!");
  } catch {
    showToast(code);
  }
}

// === Helpers ===
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// === Category Picker ===
function renderCategoryPicker() {
  const picker = document.getElementById("category-picker");
  const newCatInput = document.getElementById("input-new-category");

  const cats = [...new Set([...DEFAULT_CATEGORIES, ...state.categories])];

  let html = cats
    .map(
      (cat) =>
        `<div class="category-chip ${cat === state.selectedCategory ? "selected" : ""}" data-cat="${escapeHtml(cat)}">${CATEGORY_ICONS[cat] || "\u{1F4C1}"} ${escapeHtml(cat)}</div>`
    )
    .join("");

  html += `<div class="category-chip new-cat ${state.selectedCategory === "__new__" ? "selected" : ""}" data-cat="__new__">+ Neue</div>`;

  picker.innerHTML = html;

  // Show/hide new category input
  newCatInput.classList.toggle("hidden", state.selectedCategory !== "__new__");

  picker.querySelectorAll(".category-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.selectedCategory = chip.dataset.cat;
      renderCategoryPicker();
      if (state.selectedCategory === "__new__") {
        newCatInput.classList.remove("hidden");
        newCatInput.focus();
      } else {
        newCatInput.classList.add("hidden");
      }
    });
  });
}

// === Emoji Picker ===
function renderEmojiPicker() {
  const picker = document.getElementById("emoji-picker");
  picker.innerHTML = LIST_EMOJIS.map(
    (emoji) => `
    <div class="emoji-option ${emoji === state.selectedEmoji ? "selected" : ""}" data-emoji="${emoji}">
      ${emoji}
    </div>
  `
  ).join("");

  picker.querySelectorAll(".emoji-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      state.selectedEmoji = opt.dataset.emoji;
      picker.querySelectorAll(".emoji-option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });
}

// === Init ===
function init() {
  // Welcome view
  document.getElementById("btn-create").addEventListener("click", createHousehold);
  document.getElementById("btn-join").addEventListener("click", joinHousehold);
  document.getElementById("input-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinHousehold();
  });

  // Share view
  document.getElementById("btn-copy-code").addEventListener("click", () => {
    copyCode(state.shareCode);
  });
  document.getElementById("btn-to-lists").addEventListener("click", loadLists);

  // Lists view
  document.getElementById("btn-add-list").addEventListener("click", () => {
    state.selectedEmoji = LIST_EMOJIS[0];
    state.selectedCategory = "Einkauf";
    renderEmojiPicker();
    renderCategoryPicker();
    document.getElementById("input-list-name").value = "";
    document.getElementById("input-new-category").value = "";
    showModal("new-list");
    setTimeout(() => document.getElementById("input-list-name").focus(), 100);
  });
  document.getElementById("btn-create-list").addEventListener("click", createList);
  document.getElementById("input-list-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createList();
  });

  // Settings
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("settings-code").textContent = state.shareCode || "\u2014";
    renderMembersList();
    showModal("settings");
  });
  document.getElementById("btn-add-member").addEventListener("click", addMember);
  document.getElementById("input-new-member").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addMember();
  });
  document.getElementById("btn-copy-settings-code").addEventListener("click", () => {
    copyCode(state.shareCode);
  });
  document.getElementById("btn-leave").addEventListener("click", () => {
    hideModal("settings");
    leaveHousehold();
    showToast("Haushalt verlassen.");
  });

  // Detail view
  document.getElementById("btn-back").addEventListener("click", () => {
    stopPolling();
    state.currentListId = null;
    state.lastTs = 0;
    loadLists();
  });
  document.getElementById("btn-add-item").addEventListener("click", addItem);
  document.getElementById("input-new-item").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addItem();
  });
  document.getElementById("btn-delete-list").addEventListener("click", () => {
    showModal("delete-list");
  });
  document.getElementById("btn-confirm-delete-list").addEventListener("click", deleteList);

  // Notes view
  document.getElementById("btn-notes-back").addEventListener("click", () => {
    state.currentNoteId = null;
    loadLists();
  });
  document.getElementById("btn-add-note").addEventListener("click", () => {
    document.getElementById("input-note-title").value = "";
    showModal("new-note");
    setTimeout(() => document.getElementById("input-note-title").focus(), 100);
  });
  document.getElementById("btn-create-note").addEventListener("click", createNote);
  document.getElementById("input-note-title").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createNote();
  });

  // Calendar view
  document.getElementById("btn-cal-back").addEventListener("click", loadLists);
  document.getElementById("btn-cal-prev").addEventListener("click", () => calNavigate(-1));
  document.getElementById("btn-cal-next").addEventListener("click", () => calNavigate(1));

  // Chat view
  document.getElementById("btn-chat-back").addEventListener("click", loadLists);
  document.getElementById("btn-chat-send").addEventListener("click", sendChatMessage);
  document.getElementById("input-chat").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });

  // Note detail view
  document.getElementById("btn-note-back").addEventListener("click", () => {
    saveNote();
    state.currentNoteId = null;
    openNotes();
  });
  document.getElementById("note-content").addEventListener("input", onNoteInput);
  document.getElementById("btn-pin-note").addEventListener("click", togglePinNote);
  document.getElementById("btn-delete-note").addEventListener("click", () => {
    showModal("delete-note");
  });
  document.getElementById("btn-confirm-delete-note").addEventListener("click", deleteNote);

  // Modal close handlers
  document.querySelectorAll(".modal-backdrop, .modal-cancel").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.target.closest(".modal").classList.add("hidden");
    });
  });

  // Start app
  if (state.householdId) {
    updateHeader();
    updateAssignPicker();
    loadMembers(); // async, updates header + members in background
    loadLists();
  } else {
    showView("welcome");
  }

  // Visibility change: pause/resume polling
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
    } else if (state.currentListId) {
      state.lastTs = 0;
      fetchItems();
      startPolling();
    }
  });
}

// === Calendar ===
const MONTH_NAMES = [
  "Januar", "Februar", "Maerz", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

state.calYear = new Date().getFullYear();
state.calMonth = new Date().getMonth() + 1;
state.calItems = [];

async function openCalendar() {
  showView("calendar");
  state.calYear = new Date().getFullYear();
  state.calMonth = new Date().getMonth() + 1;
  await loadCalendarData();
}

function calNavigate(delta) {
  state.calMonth += delta;
  if (state.calMonth > 12) { state.calMonth = 1; state.calYear++; }
  if (state.calMonth < 1) { state.calMonth = 12; state.calYear--; }
  loadCalendarData();
}

async function loadCalendarData() {
  try {
    const data = await api(`calendar?year=${state.calYear}&month=${state.calMonth}`);
    state.calItems = data.items || [];
    state.calTravel = data.travel || [];
  } catch {
    state.calItems = [];
    state.calTravel = [];
  }
  renderCalendar();
}

function renderCalendar() {
  const label = document.getElementById("cal-month-label");
  label.textContent = `${MONTH_NAMES[state.calMonth - 1]} ${state.calYear}`;

  const container = document.getElementById("cal-days");
  container.innerHTML = "";

  const firstDay = new Date(state.calYear, state.calMonth - 1, 1);
  const lastDay = new Date(state.calYear, state.calMonth, 0);
  const daysInMonth = lastDay.getDate();

  // Monday=0 based start
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Group items by date
  const itemsByDate = {};
  for (const item of state.calItems) {
    if (!itemsByDate[item.due_date]) itemsByDate[item.due_date] = [];
    itemsByDate[item.due_date].push(item);
  }

  // Group travel events by date
  const travelByDate = {};
  for (const t of (state.calTravel || [])) {
    if (!travelByDate[t.due_date]) travelByDate[t.due_date] = [];
    // Deduplicate by summary+member per day
    const key = `${t.member_name}:${t.summary}`;
    if (!travelByDate[t.due_date].find((x) => `${x.member_name}:${x.summary}` === key)) {
      travelByDate[t.due_date].push(t);
    }
  }

  // Previous month padding
  const prevMonthDays = new Date(state.calYear, state.calMonth - 1, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const div = document.createElement("div");
    div.className = "cal-day other-month";
    div.innerHTML = `<span class="cal-day-number">${day}</span>`;
    container.appendChild(div);
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.calYear}-${String(state.calMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const div = document.createElement("div");
    div.className = "cal-day" + (dateStr === todayStr ? " today" : "");

    let dotsHtml = "";
    const dayItems = itemsByDate[dateStr] || [];
    const dayTravel = travelByDate[dateStr] || [];

    if (dayTravel.length > 0) {
      dotsHtml += `<div class="cal-travel-indicator">\u{2708}\u{FE0F}</div>`;
      div.classList.add("cal-day-travel");
    }

    if (dayItems.length > 0) {
      const dots = dayItems.slice(0, 4).map((item) => {
        const color = item.assigned_to ? getMemberColor(item.assigned_to) : "var(--primary)";
        return `<span class="cal-dot" style="background:${color}"></span>`;
      }).join("");
      dotsHtml += `<div class="cal-dots">${dots}</div>`;
    }

    div.innerHTML = `<span class="cal-day-number">${d}</span>${dotsHtml}`;

    if (dayItems.length > 0 || dayTravel.length > 0) {
      div.addEventListener("click", () => openDayDetail(dateStr, dayItems, dayTravel));
    }

    container.appendChild(div);
  }

  // Next month padding
  const totalCells = startDow + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    const div = document.createElement("div");
    div.className = "cal-day other-month";
    div.innerHTML = `<span class="cal-day-number">${i}</span>`;
    container.appendChild(div);
  }
}

function openDayDetail(dateStr, items, travelEvents) {
  const date = new Date(dateStr + "T00:00:00");
  const title = date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("day-detail-title").textContent = title;

  const container = document.getElementById("day-detail-items");
  let html = "";

  // Travel events first
  if (travelEvents && travelEvents.length > 0) {
    html += travelEvents.map((t) => {
      const memberColor = getMemberColor(t.member_name);
      return `
        <div class="day-item day-item-travel" style="border-left-color: ${memberColor}">
          <span class="day-item-time">\u{2708}\u{FE0F}</span>
          <div>
            <div class="day-item-name">${escapeHtml(t.summary)}</div>
            <div class="day-item-list">${escapeHtml(t.member_name)}${t.location ? " \u2022 \u{1F4CD} " + escapeHtml(t.location) : ""}</div>
            <div class="day-item-list" style="opacity:0.6">${formatDateRange(t.start_date, t.end_date)}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  // Regular items
  html += items.map((item) => {
    const color = item.assigned_to ? getMemberColor(item.assigned_to) : "var(--primary)";
    return `
      <div class="day-item" style="border-left-color: ${color}">
        <span class="day-item-time">${item.due_time || ""}</span>
        <div>
          <div class="day-item-name">${escapeHtml(item.name)}</div>
          <div class="day-item-list">${item.list_emoji} ${escapeHtml(item.list_name)}${item.assigned_to ? " \u2022 " + escapeHtml(item.assigned_to) : ""}</div>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = html;
  showModal("day-detail");
}

// === AI Chat ===
state.chatMessages = [];
state.chatLoading = false;

async function openChat() {
  showView("chat");
  if (state.chatMessages.length === 0) {
    await loadChatHistory();
  }
  scrollChatBottom();
  setTimeout(() => document.getElementById("input-chat").focus(), 100);
}

async function loadChatHistory() {
  try {
    const data = await api("chat");
    state.chatMessages = data.messages || [];
  } catch {
    state.chatMessages = [];
  }
  renderChatMessages();
}

function renderChatMessages() {
  const container = document.getElementById("chat-messages");

  if (state.chatMessages.length === 0) {
    container.innerHTML = `
      <div class="chat-bubble system">
        Hallo! Ich bin euer Familien-Assistent. \u{1F44B}<br>
        Frag mich was zum Einkauf, zu Terminen oder lass uns gemeinsam planen!
      </div>
    `;
    return;
  }

  container.innerHTML = state.chatMessages.map((msg) => {
    const timeStr = msg.created_at
      ? new Date(msg.created_at + "Z").toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
      : "";
    return `
      <div class="chat-bubble ${msg.role}">
        ${escapeHtml(msg.content).replace(/\n/g, "<br>")}
        ${timeStr ? `<span class="chat-time">${timeStr}</span>` : ""}
      </div>
    `;
  }).join("");

  scrollChatBottom();
}

function scrollChatBottom() {
  const container = document.getElementById("chat-messages");
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function showTypingIndicator() {
  const container = document.getElementById("chat-messages");
  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  indicator.id = "typing-indicator";
  indicator.innerHTML = "<span></span><span></span><span></span>";
  container.appendChild(indicator);
  scrollChatBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

async function sendChatMessage() {
  const input = document.getElementById("input-chat");
  const message = input.value.trim();
  if (!message || state.chatLoading) return;

  input.value = "";
  state.chatLoading = true;

  // Add user message immediately
  const userMsg = { role: "user", content: message, created_at: new Date().toISOString() };
  state.chatMessages.push(userMsg);
  renderChatMessages();
  showTypingIndicator();

  try {
    // Send last 10 messages as history context
    const history = state.chatMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    const data = await api("chat", {
      method: "POST",
      body: { message, history: history.slice(0, -1) }, // exclude current message
    });

    removeTypingIndicator();

    const assistantMsg = {
      role: "assistant",
      content: data.reply || "Entschuldigung, ich konnte keine Antwort generieren.",
      created_at: new Date().toISOString(),
    };
    state.chatMessages.push(assistantMsg);
    renderChatMessages();
  } catch (err) {
    removeTypingIndicator();
    const errorMsg = {
      role: "assistant",
      content: "Verbindungsfehler zum AI-Server. Bitte versuche es spaeter erneut.",
      created_at: new Date().toISOString(),
    };
    state.chatMessages.push(errorMsg);
    renderChatMessages();
  }

  state.chatLoading = false;
}

// === Push Notifications ===
async function subscribePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;

    // Check if already subscribed
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // Send to server in case household changed
      await sendSubscription(existing);
      return;
    }

    // Get VAPID key
    const keyData = await api("vapid-key");
    if (!keyData.publicKey) return;

    // Convert base64url to Uint8Array
    const key = urlBase64ToUint8Array(keyData.publicKey);

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });

    await sendSubscription(sub);
    showToast("Benachrichtigungen aktiviert!");
  } catch (err) {
    // User denied or error
    console.log("Push subscription failed:", err);
  }
}

async function sendSubscription(sub) {
  const json = sub.toJSON();
  await api("push", {
    method: "POST",
    body: {
      endpoint: json.endpoint,
      keys: json.keys,
    },
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Register Service Worker + Push
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(() => {
    // Request notification permission after first interaction
    if (state.householdId && Notification.permission === "default") {
      // Wait for user interaction to ask
      document.addEventListener("click", function askPush() {
        document.removeEventListener("click", askPush);
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") subscribePush();
        });
      }, { once: true });
    } else if (state.householdId && Notification.permission === "granted") {
      subscribePush();
    }
  }).catch(() => {});
}

// === Travel / TripIt ===
state.travelEvents = [];
state.travelFeeds = [];

async function openTravel() {
  showView("travel");
  await loadTravelData();

  document.getElementById("btn-travel-back").onclick = () => { showView("lists"); renderLists(); };
  document.getElementById("btn-travel-add-feed").onclick = () => openTravelFeedModal();
  document.getElementById("btn-save-feed").onclick = saveTravelFeed;
}

async function loadTravelData() {
  try {
    const data = await api("travel");
    state.travelEvents = data.events || [];
    state.travelFeeds = data.feeds || [];
  } catch {
    state.travelEvents = [];
    state.travelFeeds = [];
  }
  renderTravel();
}

function renderTravel() {
  const container = document.getElementById("travel-container");
  const emptyEl = document.getElementById("travel-empty");
  const nextEl = document.getElementById("travel-next");
  const feedsList = document.getElementById("travel-feeds-list");

  // Feeds section
  if (state.travelFeeds.length > 0) {
    feedsList.innerHTML = state.travelFeeds.map((f) => `
      <div class="travel-feed-row">
        <span class="travel-feed-member">${escapeHtml(f.member_name)}</span>
        <span class="travel-feed-label">${escapeHtml(f.label)}</span>
        <button class="btn-icon btn-danger-icon travel-feed-delete" data-id="${f.id}" title="Entfernen">\u{1F5D1}\u{FE0F}</button>
      </div>
    `).join("");

    feedsList.querySelectorAll(".travel-feed-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`travel?id=${btn.dataset.id}`, { method: "DELETE" });
        await loadTravelData();
      });
    });
    document.getElementById("travel-feeds-section").classList.remove("hidden");
  } else {
    document.getElementById("travel-feeds-section").classList.add("hidden");
  }

  if (state.travelEvents.length === 0) {
    nextEl.classList.add("hidden");
    container.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");

  // Group overlapping events into trips
  const trips = groupTrips(state.travelEvents);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Next trip countdown
  const upcoming = trips.find((t) => new Date(t.end_date + "T23:59:59") >= today);
  if (upcoming) {
    const start = new Date(upcoming.start_date + "T00:00:00");
    const diffDays = Math.ceil((start - today) / 86400000);
    let countdownText;
    if (diffDays < 0) {
      countdownText = "Gerade unterwegs";
    } else if (diffDays === 0) {
      countdownText = "Heute!";
    } else if (diffDays === 1) {
      countdownText = "Morgen";
    } else {
      countdownText = `in ${diffDays} Tagen`;
    }

    const memberColor = getMemberColor(upcoming.member_name);
    nextEl.innerHTML = `
      <div class="travel-next-card" style="border-left-color: ${memberColor}">
        <div class="travel-next-header">
          <span class="travel-countdown-badge">${countdownText}</span>
          <span class="travel-next-member" style="color: ${memberColor}">${escapeHtml(upcoming.member_name)}</span>
        </div>
        <div class="travel-next-title">${escapeHtml(upcoming.summary)}</div>
        ${upcoming.location ? `<div class="travel-next-location">\u{1F4CD} ${escapeHtml(upcoming.location)}</div>` : ""}
        <div class="travel-next-dates">${formatDateRange(upcoming.start_date, upcoming.end_date)}</div>
      </div>
    `;
    nextEl.classList.remove("hidden");
  } else {
    nextEl.classList.add("hidden");
  }

  // All trips timeline
  container.innerHTML = trips.map((trip) => {
    const memberColor = getMemberColor(trip.member_name);
    const isPast = new Date(trip.end_date + "T23:59:59") < today;
    return `
      <div class="travel-card${isPast ? " travel-past" : ""}" style="border-left-color: ${memberColor}">
        <div class="travel-card-header">
          <span class="travel-card-dates">${formatDateRange(trip.start_date, trip.end_date)}</span>
          <span class="travel-card-member" style="color: ${memberColor}">${escapeHtml(trip.member_name)}</span>
        </div>
        <div class="travel-card-title">${escapeHtml(trip.summary)}</div>
        ${trip.location ? `<div class="travel-card-location">\u{1F4CD} ${escapeHtml(trip.location)}</div>` : ""}
      </div>
    `;
  }).join("");
}

function groupTrips(events) {
  // Deduplicate by uid (multi-day events come as one entry from travel API)
  const seen = new Map();
  for (const ev of events) {
    const key = `${ev.member_name}:${ev.summary}:${ev.start_date}:${ev.end_date}`;
    if (!seen.has(key)) {
      seen.set(key, ev);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.start_date.localeCompare(b.start_date));
}

function formatDateRange(start, end) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts = { day: "numeric", month: "short" };
  if (start === end) {
    return s.toLocaleDateString("de-DE", { ...opts, year: "numeric" });
  }
  if (s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString("de-DE", opts)} \u2013 ${e.toLocaleDateString("de-DE", { ...opts, year: "numeric" })}`;
  }
  return `${s.toLocaleDateString("de-DE", { ...opts, year: "numeric" })} \u2013 ${e.toLocaleDateString("de-DE", { ...opts, year: "numeric" })}`;
}

function openTravelFeedModal() {
  // Populate member dropdown
  const select = document.getElementById("input-travel-member");
  select.innerHTML = (state.members || []).map((m) =>
    `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`
  ).join("");
  if (select.options.length === 0) {
    select.innerHTML = `<option value="">Erst Mitglieder hinzufuegen</option>`;
  }
  document.getElementById("input-travel-url").value = "";
  showModal("travel-feed");
}

async function saveTravelFeed() {
  const memberName = document.getElementById("input-travel-member").value;
  const feedUrl = document.getElementById("input-travel-url").value.trim();
  if (!memberName || !feedUrl) {
    showToast("Bitte Mitglied und URL angeben");
    return;
  }
  try {
    await api("travel", {
      method: "POST",
      body: { member_name: memberName, feed_url: feedUrl },
    });
    closeAllModals();
    showToast("Feed gespeichert!");
    await loadTravelData();
  } catch (err) {
    showToast("Fehler: " + (err.message || "Feed konnte nicht gespeichert werden"));
  }
}

// Update travel subtitle on main page
async function updateTravelSubtitle() {
  try {
    const data = await api("travel");
    const events = data.events || [];
    const sub = document.getElementById("travel-card-subtitle");
    if (!sub) return;
    if (events.length === 0) {
      sub.textContent = "TripIt";
    } else {
      const today = new Date().toISOString().split("T")[0];
      const upcoming = events.find((e) => e.end_date >= today);
      if (upcoming) {
        const start = new Date(upcoming.start_date + "T00:00:00");
        const diff = Math.ceil((start - new Date().setHours(0,0,0,0)) / 86400000);
        if (diff <= 0) sub.textContent = "Unterwegs!";
        else if (diff === 1) sub.textContent = "Morgen!";
        else sub.textContent = `in ${diff} Tagen`;
      } else {
        sub.textContent = `${events.length} Reisen`;
      }
    }
  } catch {
    // silent
  }
}

document.addEventListener("DOMContentLoaded", init);
