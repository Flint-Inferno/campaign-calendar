/* ── App state ──────────────────────────────────────────────── */
let CFG = null;
let CURRENT_DATE = null;
let mapLoaded = false;
let editingEventId = null;

const COLOR_SWATCHES = [
  '#8B2E2E','#6B3A2A','#8B6914','#2E5A1C','#1C3D5A',
  '#5A1C5A','#1C5A5A','#5A4A2A','#8B7355','#2C4A1C',
  '#4A1C2C','#1C4A3A','#6B1C2C','#2C2C6B','#6B6B1C','#3A1C6B'
];

/* ── Init ───────────────────────────────────────────────────── */
async function appInit() {
  showBanner('Loading…', 'info');
  try {
    const [cfgRes, evRes, cdRes] = await Promise.all([
      GithubAPI.readFile('data/config.json'),
      GithubAPI.readFile('data/events.json').catch(() => ({ content: [] })),
      GithubAPI.readFile('data/current-date.json').catch(() => ({ content: { year:1,month:1,week:1,day:1,hour:0 } }))
    ]);
    CFG = cfgRes.content;
    Events.importJSON(evRes.content);
    CURRENT_DATE = cdRes.content;
  } catch (e) {
    showBanner('Failed to load calendar data. Check your internet connection.', 'error');
    return;
  }

  document.title = CFG.calendarName || 'Campaign Calendar';
  document.getElementById('calendar-name').textContent = CFG.calendarName || 'Campaign Calendar';
  document.documentElement.style.setProperty('--days-per-week', CFG.daysPerWeek);

  Calendar.init(document.getElementById('calendar-grid'), CFG, CURRENT_DATE);
  Calendar.onEventClick = openViewModal;
  Calendar.onCellClick = (date) => openAddModal(date);

  MapView.init(document.getElementById('map-container'), CFG);

  updateCurrentDateDisplay();
  Calendar.render();
  updateNavLabel();
  hideBanner();

  const pat = GithubAPI.getPAT();
  if (pat) {
    document.getElementById('pat-status').textContent = '✓ Connected';
    document.getElementById('pat-status').className = 'pat-ok';
  }
}

/* ── Tab switching ──────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab}`));
    if (tab === 'map' && !mapLoaded) initMap();
  });
});

async function initMap() {
  showBanner('Loading map…', 'info');
  try {
    await MapView.loadMap();
    MapView.renderPins(Events.getAll());
    mapLoaded = true;
    hideBanner();
  } catch (e) {
    document.getElementById('map-placeholder').classList.remove('hidden');
    hideBanner();
  }
  MapView.invalidateSize();
}

/* ── Calendar view toggle ───────────────────────────────────── */
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Calendar.setView(btn.dataset.view);
    Calendar.render();
    updateNavLabel();
  });
});

/* ── Navigation ─────────────────────────────────────────────── */
document.getElementById('prev-btn').addEventListener('click', () => { Calendar.navigatePrev(); Calendar.render(); updateNavLabel(); });
document.getElementById('next-btn').addEventListener('click', () => { Calendar.navigateNext(); Calendar.render(); updateNavLabel(); });
document.getElementById('today-btn').addEventListener('click', () => {
  if (CURRENT_DATE) { Calendar.goToDate(CURRENT_DATE); Calendar.render(); updateNavLabel(); }
});

function updateNavLabel() {
  document.getElementById('nav-label').textContent = Calendar.navLabel();
}

/* ── Add Event button ───────────────────────────────────────── */
document.getElementById('add-event-btn').addEventListener('click', () => {
  const nav = Calendar.getNav();
  openAddModal({ year: nav.year, month: nav.month, week: nav.week, day: 1, hour: 0 });
});

/* ── Event modal ─────────────────────────────────────────────── */
function openAddModal(prefill = {}, mapCoords = null) {
  editingEventId = null;
  populateModal({
    year: prefill.year || 1, month: prefill.month || 1, week: prefill.week || 1,
    day: prefill.day || 1, hour: prefill.hour || 0,
    mapX: mapCoords ? mapCoords.x : null,
    mapY: mapCoords ? mapCoords.y : null
  });
  document.getElementById('modal-title-heading').textContent = 'New Event';
  document.getElementById('delete-event-btn').classList.add('hidden');
  openModal('event-modal');
}

function openViewModal(id) {
  const ev = Events.getAll().find(e => e.id === id);
  if (!ev) return;
  editingEventId = id;
  populateModal(ev);
  document.getElementById('modal-title-heading').textContent = 'Edit Event';
  document.getElementById('delete-event-btn').classList.remove('hidden');
  openModal('event-modal');
}

function populateModal(data) {
  const f = document.getElementById('event-form');
  f.querySelector('[name=title]').value = data.title || '';
  f.querySelector('[name=description]').value = data.description || '';
  fillDatePickers('start', data);
  const hasEnd = data.endYear != null;
  f.querySelector('[name=has-end]').checked = hasEnd;
  toggleEndDate(hasEnd);
  if (hasEnd) fillDatePickers('end', { year: data.endYear, month: data.endMonth, week: data.endWeek, day: data.endDay, hour: data.endHour || 0 });
  f.querySelector('[name=tags]').value = (data.tags || []).join(', ');
  f.querySelector('[name=mapX]').value = data.mapX != null ? data.mapX : '';
  f.querySelector('[name=mapY]').value = data.mapY != null ? data.mapY : '';
  setModalColor(data.color || (CFG && CFG.defaultEventColor) || '#6B3A2A');
}

function fillDatePickers(prefix, d) {
  const f = document.getElementById('event-form');
  f.querySelector(`[name=${prefix}-year]`).value = d.year || 1;
  setSelectValue(f.querySelector(`[name=${prefix}-month]`), d.month || 1);
  setSelectValue(f.querySelector(`[name=${prefix}-week]`), d.week || 1);
  setSelectValue(f.querySelector(`[name=${prefix}-day]`), d.day || 1);
  setSelectValue(f.querySelector(`[name=${prefix}-hour]`), d.hour || 0);
}

function setSelectValue(sel, val) {
  if (!sel) return;
  sel.value = String(val);
  if (sel.value === '') sel.value = sel.options[0]?.value || '';
}

function toggleEndDate(show) {
  document.getElementById('end-date-row').classList.toggle('hidden', !show);
}

document.getElementById('event-form').querySelector('[name=has-end]').addEventListener('change', e => toggleEndDate(e.target.checked));

function readModalColor() {
  return document.getElementById('color-hex-input').value || '#6B3A2A';
}

function setModalColor(hex) {
  document.getElementById('color-hex-input').value = hex;
  document.getElementById('color-preview').style.background = hex;
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === hex);
  });
}

document.querySelectorAll('.color-swatch').forEach(s => {
  s.addEventListener('click', () => setModalColor(s.dataset.color));
});

document.getElementById('color-hex-input').addEventListener('input', e => {
  const v = e.target.value;
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
    document.getElementById('color-preview').style.background = v;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === v));
  }
});

function collectModalData() {
  const f = document.getElementById('event-form');
  const get = name => f.querySelector(`[name=${name}]`);
  const hasEnd = get('has-end').checked;
  const mapXVal = get('mapX').value.trim();
  const mapYVal = get('mapY').value.trim();
  return {
    title: get('title').value.trim(),
    description: get('description').value.trim(),
    year: +get('start-year').value,
    month: +get('start-month').value,
    week: +get('start-week').value,
    day: +get('start-day').value,
    hour: +get('start-hour').value,
    ...(hasEnd ? {
      endYear: +get('end-year').value,
      endMonth: +get('end-month').value,
      endWeek: +get('end-week').value,
      endDay: +get('end-day').value,
      endHour: +get('end-hour').value
    } : {}),
    color: readModalColor(),
    tags: get('tags').value.split(',').map(t => t.trim()).filter(Boolean),
    mapX: mapXVal !== '' ? +mapXVal : null,
    mapY: mapYVal !== '' ? +mapYVal : null
  };
}

document.getElementById('save-event-btn').addEventListener('click', async () => {
  const data = collectModalData();
  if (!data.title) { showBanner('Title is required.', 'error'); return; }
  if (!GithubAPI.getPAT()) { showBanner('Enter your PAT to save changes.', 'error'); openPATPanel(); return; }
  setBusy(true);
  try {
    if (editingEventId) {
      await Events.update(editingEventId, data);
    } else {
      await Events.add(data);
    }
    closeModal('event-modal');
    Calendar.render();
    if (mapLoaded) { MapView.renderPins(Events.getAll()); MapView.renderTrail(Events.getAll()); }
    showBanner('Saved!', 'success');
  } catch (e) {
    showBanner(e.message, 'error');
  }
  setBusy(false);
});

document.getElementById('delete-event-btn').addEventListener('click', async () => {
  if (!editingEventId) return;
  if (!confirm('Delete this event?')) return;
  if (!GithubAPI.getPAT()) { showBanner('Enter your PAT to delete events.', 'error'); openPATPanel(); return; }
  setBusy(true);
  try {
    await Events.remove(editingEventId);
    closeModal('event-modal');
    Calendar.render();
    if (mapLoaded) { MapView.renderPins(Events.getAll()); MapView.renderTrail(Events.getAll()); }
    showBanner('Event deleted.', 'success');
  } catch (e) {
    showBanner(e.message, 'error');
  }
  setBusy(false);
});

document.getElementById('cancel-event-btn').addEventListener('click', () => closeModal('event-modal'));
document.getElementById('event-modal').querySelector('.modal-backdrop').addEventListener('click', () => closeModal('event-modal'));

/* ── Time calculator ────────────────────────────────────────── */
document.getElementById('advance-time-toggle').addEventListener('click', () => {
  document.getElementById('time-calc-panel').classList.toggle('hidden');
});

document.getElementById('calc-btn').addEventListener('click', () => {
  if (!CFG) return;
  const f = document.getElementById('time-calc-form');
  const base = {
    year:  +f.querySelector('[name=tc-year]').value  || 1,
    month: +f.querySelector('[name=tc-month]').value || 1,
    week:  +f.querySelector('[name=tc-week]').value  || 1,
    day:   +f.querySelector('[name=tc-day]').value   || 1,
    hour:  +f.querySelector('[name=tc-hour]').value  || 0
  };
  const dur = {
    years:  +f.querySelector('[name=dur-years]').value  || 0,
    months: +f.querySelector('[name=dur-months]').value || 0,
    weeks:  +f.querySelector('[name=dur-weeks]').value  || 0,
    days:   +f.querySelector('[name=dur-days]').value   || 0,
    hours:  +f.querySelector('[name=dur-hours]').value  || 0
  };
  const result = TimeCalc.add(base, dur, CFG);
  document.getElementById('calc-result').textContent = TimeCalc.format(result, CFG);
  document.getElementById('calc-result-row').classList.remove('hidden');
  document.getElementById('set-current-btn').dataset.result = JSON.stringify(result);
});

document.getElementById('set-current-btn').addEventListener('click', async () => {
  const result = JSON.parse(document.getElementById('set-current-btn').dataset.result || 'null');
  if (!result) return;
  if (!GithubAPI.getPAT()) { showBanner('Enter your PAT to advance the current date.', 'error'); openPATPanel(); return; }
  setBusy(true);
  try {
    await GithubAPI.writeJSON('data/current-date.json', result, `Advance time to ${TimeCalc.format(result, CFG)}`);
    CURRENT_DATE = result;
    Calendar.setCurrentDate(CURRENT_DATE);
    Calendar.render();
    updateCurrentDateDisplay();
    showBanner('Current date updated!', 'success');
  } catch (e) {
    showBanner(e.message, 'error');
  }
  setBusy(false);
});

function fillTimecalcFromCurrent() {
  if (!CURRENT_DATE) return;
  const f = document.getElementById('time-calc-form');
  f.querySelector('[name=tc-year]').value  = CURRENT_DATE.year;
  f.querySelector('[name=tc-month]').value = CURRENT_DATE.month;
  f.querySelector('[name=tc-week]').value  = CURRENT_DATE.week;
  f.querySelector('[name=tc-day]').value   = CURRENT_DATE.day;
  f.querySelector('[name=tc-hour]').value  = CURRENT_DATE.hour || 0;
}

document.getElementById('advance-time-toggle').addEventListener('click', fillTimecalcFromCurrent);

function updateCurrentDateDisplay() {
  if (!CURRENT_DATE || !CFG) return;
  document.getElementById('current-date-display').textContent = TimeCalc.format(CURRENT_DATE, CFG);
}

/* ── PAT panel ──────────────────────────────────────────────── */
document.getElementById('pat-toggle').addEventListener('click', () => {
  document.getElementById('pat-panel').classList.toggle('hidden');
});

function openPATPanel() {
  document.getElementById('pat-panel').classList.remove('hidden');
}

document.getElementById('pat-save').addEventListener('click', async () => {
  const val = document.getElementById('pat-input').value.trim();
  if (!val) return;
  try {
    const login = await GithubAPI.testPAT(val);
    GithubAPI.setPAT(val);
    document.getElementById('pat-status').textContent = `✓ ${login}`;
    document.getElementById('pat-status').className = 'pat-ok';
    showBanner(`Connected as ${login}`, 'success');
    document.getElementById('pat-panel').classList.add('hidden');
  } catch (e) {
    showBanner(e.message, 'error');
  }
});


/* ── Map controls ────────────────────────────────────────────── */
document.getElementById('pin-mode-btn').addEventListener('click', () => {
  if (!GithubAPI.getPAT()) { showBanner('Enter your PAT to place pins.', 'error'); openPATPanel(); return; }
  if (MapView.isPinMode()) {
    MapView.disablePinMode();
    document.getElementById('pin-mode-btn').classList.remove('active');
  } else {
    MapView.enablePinMode((x, y) => {
      MapView.disablePinMode();
      document.getElementById('pin-mode-btn').classList.remove('active');
      const nav = Calendar.getNav();
      openAddModal({ year: nav.year, month: nav.month, week: nav.week, day: 1, hour: 0 }, { x, y });
    });
    document.getElementById('pin-mode-btn').classList.add('active');
  }
});

document.getElementById('trail-toggle-btn').addEventListener('click', () => {
  const visible = MapView.toggleTrail(Events.getAll());
  document.getElementById('trail-toggle-btn').classList.toggle('active', visible);
});

document.addEventListener('map:goto-event', e => {
  const id = e.detail.id;
  const ev = Events.getAll().find(ev => ev.id === id);
  if (!ev) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'calendar'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== 'tab-calendar'));
  Calendar.goToDate(ev);
  Calendar.render();
  updateNavLabel();
  setTimeout(() => openViewModal(id), 100);
});

/* ── Modal helpers ──────────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.overflow = '';
}

/* ── Banner ─────────────────────────────────────────────────── */
let bannerTimer = null;
function showBanner(msg, type = 'info') {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.className = `banner banner-${type}`;
  el.classList.remove('hidden');
  clearTimeout(bannerTimer);
  if (type !== 'error') bannerTimer = setTimeout(hideBanner, 3000);
}
function hideBanner() {
  document.getElementById('banner').classList.add('hidden');
}

/* ── Busy state ─────────────────────────────────────────────── */
function setBusy(on) {
  document.getElementById('save-event-btn').disabled = on;
  document.getElementById('save-event-btn').textContent = on ? 'Saving…' : 'Save';
}

/* ── Build selects from config ──────────────────────────────── */
function buildSelects() {
  if (!CFG) return;
  buildMonthSelect('start-month');
  buildMonthSelect('end-month');
  buildWeekSelect('start-week');
  buildWeekSelect('end-week');
  buildDaySelect('start-day');
  buildDaySelect('end-day');
  buildHourSelect('start-hour');
  buildHourSelect('end-hour');
  buildMonthSelect('tc-month');
  buildWeekSelect('tc-week');
  buildDaySelect('tc-day');
  buildHourSelect('tc-hour');
}

function buildMonthSelect(name) {
  const sel = document.querySelector(`[name=${name}]`);
  if (!sel) return;
  sel.innerHTML = CFG.monthNames.map((n, i) => `<option value="${i+1}">${n}</option>`).join('');
}
function buildWeekSelect(name) {
  const sel = document.querySelector(`[name=${name}]`);
  if (!sel) return;
  sel.innerHTML = CFG.weekNames.map((n, i) => `<option value="${i+1}">${n}</option>`).join('');
}
function buildDaySelect(name) {
  const sel = document.querySelector(`[name=${name}]`);
  if (!sel) return;
  sel.innerHTML = Array.from({length: CFG.daysPerWeek}, (_, i) => {
    const dn = (CFG.dayNames || [])[i] || (i + 1);
    return `<option value="${i+1}">${dn}</option>`;
  }).join('');
}
function buildHourSelect(name) {
  const sel = document.querySelector(`[name=${name}]`);
  if (!sel) return;
  sel.innerHTML = Array.from({length: CFG.hoursPerDay}, (_, i) =>
    `<option value="${i}">${String(i).padStart(2,'0')}:00</option>`
  ).join('');
}

/* ── Boot ───────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  buildColorSwatches();
  await appInit();
  buildSelects();
});

function buildColorSwatches() {
  const grid = document.getElementById('color-swatch-grid');
  if (!grid) return;
  grid.innerHTML = COLOR_SWATCHES.map(c =>
    `<div class="color-swatch" data-color="${c}" style="background:${c}" title="${c}"></div>`
  ).join('');
  grid.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', () => setModalColor(s.dataset.color));
  });
}
