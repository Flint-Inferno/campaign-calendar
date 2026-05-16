/* ── App state ──────────────────────────────────────────────── */
let CFG = null;
let CURRENT_DATE = null;
let mapLoaded = false;
let timelineLoaded = false;
let editingEventId = null;
let _mvtDate = null;
let _scrubDate = null;
let _pendingMapPin = null;
let _openedFromTimeline = false;
let _saveAndAddWaypoint = false;

const COLOR_SWATCHES = [
  '#8B2E2E','#6B3A2A','#8B6914','#2E5A1C','#1C3D5A',
  '#5A1C5A','#1C5A5A','#5A4A2A','#8B7355','#2C4A1C',
  '#4A1C2C','#1C4A3A','#6B1C2C','#2C2C6B','#6B6B1C','#3A1C6B'
];

/* ── Init ───────────────────────────────────────────────────── */
async function appInit() {
  showBanner('Loading…', 'info');
  try {
    const [cfgRes, evRes, cdRes, mvtRes, wtRes, logRes] = await Promise.all([
      GithubAPI.readFile('data/config.json'),
      GithubAPI.readFile('data/events.json').catch(() => ({ content: [] })),
      GithubAPI.readFile('data/current-date.json').catch(() => ({ content: { year:1,month:1,week:1,day:1,hour:0 } })),
      GithubAPI.readFile('data/movements.json').catch(() => ({ content: [] })),
      GithubAPI.readFile('data/write-token.json').catch(() => ({ content: {} })),
      GithubAPI.readFile('data/activity-log.json').catch(() => ({ content: [] }))
    ]);
    CFG = cfgRes.content;
    Events.importJSON(evRes.content);
    CURRENT_DATE = cdRes.content;
    _scrubDate = CURRENT_DATE
      ? { year: CURRENT_DATE.year, month: CURRENT_DATE.month, week: CURRENT_DATE.week, day: CURRENT_DATE.day, hour: 0 }
      : { year: 1, month: 1, week: 1, day: 1, hour: 0 };
    Movements.importJSON(mvtRes.content);
    ActivityLog.importJSON(logRes.content);
    const writeToken = wtRes.content?.token || '';
    if (writeToken) GithubAPI.setPAT(writeToken);
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
  Calendar.onMovementClick = openMovementModal;

  MapView.init(document.getElementById('map-container'), CFG);

  updateCurrentDateDisplay();
  Calendar.render();
  updateNavLabel();
  hideBanner();

  updateIdentityDisplay();
  updateScrubLabel();
  startUpdatePoll();
}

/* ── Tab switching ──────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab}`));
    document.getElementById('app-sidebar')?.classList.toggle('hidden', tab === 'log');
    if (tab === 'map') {
      if (!mapLoaded) initMap();
      else {
        MapView.invalidateSize();
        MapView.renderCurrentLocation(CURRENT_DATE);
        if (_pendingMapPin) { enablePinForEvent(_pendingMapPin); _pendingMapPin = null; }
      }
    }
    if (tab === 'timeline') initTimeline();
    if (tab === 'log') renderLogTab();
  });
});

async function initMap() {
  showBanner('Loading map…', 'info');
  try {
    await MapView.loadMap();
    if (!_scrubDate) _scrubDate = { year: 1, month: 1, week: 1, day: 1, hour: 0 };
    updateScrubLabel();
    MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
    MapView.renderCurrentLocation(CURRENT_DATE);
    mapLoaded = true;
    hideBanner();
    if (_pendingMapPin) { enablePinForEvent(_pendingMapPin); _pendingMapPin = null; }
    else if (_pendingLocationPick) { _pendingLocationPick = false; enterLocationPickMode(); }
  } catch (e) {
    document.getElementById('map-placeholder').classList.remove('hidden');
    hideBanner();
    if (_pendingLocationPick) { _pendingLocationPick = false; openAdvanceConfirmModal(); }
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
  openAddModal(CURRENT_DATE ? { ...CURRENT_DATE } : { year: 1, month: 1, week: 1, day: 1, hour: 0 });
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
  document.getElementById('reposition-pin-btn').classList.add('hidden');
  openModal('event-modal');
}

function openViewModal(id) {
  const ev = Events.getAll().find(e => e.id === id);
  if (!ev) return;
  editingEventId = id;
  populateModal(ev);
  document.getElementById('modal-title-heading').textContent = 'Edit Event';
  document.getElementById('delete-event-btn').classList.remove('hidden');
  document.getElementById('reposition-pin-btn').classList.remove('hidden');
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
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  setBusy(true);
  try {
    let savedId = editingEventId;
    if (editingEventId) {
      await Events.update(editingEventId, data);
      appendActivityLog('event_edit', `Edited event: "${data.title}"`);
    } else {
      const newEvent = await Events.add(data);
      appendActivityLog('event_add', `Added event: "${data.title}"`);
      savedId = newEvent.id;
    }
    closeModal('event-modal');
    Calendar.render();
    refreshTimeline();
    const waypoint = _saveAndAddWaypoint; _saveAndAddWaypoint = false;
    const fromTimeline = _openedFromTimeline; _openedFromTimeline = false;
    if (waypoint || fromTimeline) {
      _pendingMapPin = savedId;
      document.querySelector('.tab-btn[data-tab="map"]')?.click();
      showBanner('Event saved! Click the map to place a waypoint.', 'success');
    } else {
      if (mapLoaded && _scrubDate) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
      showBanner('Saved!', 'success');
    }
  } catch (e) {
    showBanner(e.message, 'error');
  }
  setBusy(false);
});

document.getElementById('delete-event-btn').addEventListener('click', async () => {
  if (!editingEventId) return;
  if (!confirm('Delete this event?')) return;
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  setBusy(true);
  try {
    const evTitle = Events.getAll().find(e => e.id === editingEventId)?.title || 'Unknown';
    await Events.remove(editingEventId);
    appendActivityLog('event_delete', `Deleted event: "${evTitle}"`);
    closeModal('event-modal');
    Calendar.render();
    if (mapLoaded && _scrubDate) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
    refreshTimeline();
    showBanner('Event deleted.', 'success');
  } catch (e) {
    showBanner(e.message, 'error');
  }
  setBusy(false);
});

document.getElementById('cancel-event-btn').addEventListener('click', () => { _openedFromTimeline = false; closeModal('event-modal'); });
document.getElementById('event-modal').querySelector('.modal-backdrop').addEventListener('click', () => { _openedFromTimeline = false; closeModal('event-modal'); });

/* ── Time calculator ────────────────────────────────────────── */
document.getElementById('advance-time-toggle').addEventListener('click', () => {
  const panel = document.getElementById('time-calc-panel');
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (opening) {
    ['dur-years','dur-months','dur-weeks','dur-days','dur-hours'].forEach(n => {
      const el = document.querySelector(`[name=${n}]`);
      if (el) el.value = '0';
    });
    document.getElementById('calc-result-row')?.classList.add('hidden');
    document.getElementById('tc-dir-btn').classList.add('active');
    document.getElementById('tc-dir-btn-back').classList.remove('active');
  }
});

document.getElementById('tc-dir-btn').addEventListener('click', () => {
  document.getElementById('tc-dir-btn').classList.add('active');
  document.getElementById('tc-dir-btn-back').classList.remove('active');
});
document.getElementById('tc-dir-btn-back').addEventListener('click', () => {
  document.getElementById('tc-dir-btn-back').classList.add('active');
  document.getElementById('tc-dir-btn').classList.remove('active');
});

document.getElementById('calc-btn').addEventListener('click', () => {
  if (!CFG || !CURRENT_DATE) return;
  const backward = document.getElementById('tc-dir-btn-back').classList.contains('active');
  const sign = backward ? -1 : 1;
  const f = document.getElementById('time-calc-form');
  const dur = {
    years:  sign * (+f.querySelector('[name=dur-years]').value  || 0),
    months: sign * (+f.querySelector('[name=dur-months]').value || 0),
    weeks:  sign * (+f.querySelector('[name=dur-weeks]').value  || 0),
    days:   sign * (+f.querySelector('[name=dur-days]').value   || 0),
    hours:  sign * (+f.querySelector('[name=dur-hours]').value  || 0)
  };
  const result = TimeCalc.add(CURRENT_DATE, dur, CFG);
  document.getElementById('calc-result').textContent = TimeCalc.format(result, CFG);
  document.getElementById('calc-result-row').classList.remove('hidden');
  document.getElementById('set-current-btn').dataset.result = JSON.stringify(result);
});

let _pendingAdvanceResult = null;
let _pendingLocationCoords = null;
let _pendingLocationPick = false;

function openAdvanceConfirmModal() {
  document.getElementById('advance-confirm-to').textContent = `→ ${TimeCalc.format(_pendingAdvanceResult, CFG)}`;
  document.getElementById('advance-location-text').value = CURRENT_DATE?.currentLocation || '';
  document.getElementById('advance-reason-text').value = '';
  document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
  openModal('advance-confirm-modal');
}

function enterLocationPickMode() {
  MapView.enablePinMode((x, y) => {
    MapView.disablePinMode();
    hideBanner();
    _pendingLocationCoords = { x, y };
    openAdvanceConfirmModal();
  });
  const el = document.getElementById('banner');
  el.innerHTML = 'Click the map to mark your destination &nbsp;<button id="skip-location-btn" class="banner-skip-btn">Skip →</button>';
  el.className = 'banner banner-info';
  el.classList.remove('hidden');
  clearTimeout(bannerTimer);
  document.getElementById('skip-location-btn')?.addEventListener('click', () => {
    MapView.disablePinMode();
    hideBanner();
    openAdvanceConfirmModal();
  });
}

document.getElementById('set-current-btn').addEventListener('click', () => {
  const result = JSON.parse(document.getElementById('set-current-btn').dataset.result || 'null');
  if (!result) return;
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  _pendingAdvanceResult = result;
  _pendingLocationCoords = null;
  document.querySelector('.tab-btn[data-tab="map"]')?.click();
  setTimeout(() => {
    if (mapLoaded) enterLocationPickMode();
    else _pendingLocationPick = true;
  }, 0);
});

document.querySelectorAll('.reason-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('advance-confirm-ok')?.addEventListener('click', async () => {
  if (!_pendingAdvanceResult) return;
  const preset = document.querySelector('.reason-btn.active')?.dataset.reason || '';
  const details = document.getElementById('advance-reason-text').value.trim();
  const reason = [preset, details].filter(Boolean).join(': ');
  const location = document.getElementById('advance-location-text').value.trim();
  const result = { ..._pendingAdvanceResult };
  if (location) {
    result.currentLocation = location;
    if (_pendingLocationCoords) {
      result.locationX = _pendingLocationCoords.x;
      result.locationY = _pendingLocationCoords.y;
    } else if (location === CURRENT_DATE?.currentLocation) {
      if (CURRENT_DATE.locationX != null) result.locationX = CURRENT_DATE.locationX;
      if (CURRENT_DATE.locationY != null) result.locationY = CURRENT_DATE.locationY;
    } else {
      delete result.locationX;
      delete result.locationY;
    }
  } else {
    delete result.currentLocation;
    delete result.locationX;
    delete result.locationY;
  }

  const btn = document.getElementById('advance-confirm-ok');
  btn.disabled = true;
  try {
    await GithubAPI.writeJSON('data/current-date.json', result, `Advance time to ${TimeCalc.format(result, CFG)}`);
    const logMsg = reason ? `Advanced to ${TimeCalc.format(result, CFG)} — ${reason}` : `Advanced to ${TimeCalc.format(result, CFG)}`;
    appendActivityLog('date_advance', logMsg);
    CURRENT_DATE = result;
    Calendar.setCurrentDate(CURRENT_DATE);
    Calendar.render();
    updateCurrentDateDisplay();
    _scrubDate = { year: result.year, month: result.month, week: result.week, day: result.day, hour: 0 };
    updateScrubLabel();
    if (mapLoaded) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
    if (mapLoaded) MapView.renderCurrentLocation(CURRENT_DATE);
    closeModal('advance-confirm-modal');
    _pendingAdvanceResult = null;
    _pendingLocationCoords = null;
    showBanner('Time advanced!', 'success');
  } catch (e) {
    showBanner(e.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('advance-confirm-cancel')?.addEventListener('click', () => {
  closeModal('advance-confirm-modal');
  _pendingAdvanceResult = null;
  _pendingLocationCoords = null;
});
document.getElementById('advance-confirm-modal')?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  closeModal('advance-confirm-modal');
  _pendingAdvanceResult = null;
  _pendingLocationCoords = null;
});

function updateCurrentDateDisplay() {
  if (!CURRENT_DATE || !CFG) return;
  document.getElementById('current-date-display').textContent = TimeCalc.format(CURRENT_DATE, CFG);
  const locEl = document.getElementById('current-location-display');
  if (locEl) locEl.textContent = CURRENT_DATE.currentLocation || '';
  updateClock(CURRENT_DATE.hour || 0);
}

function initClock() {
  const g = document.getElementById('clock-markers');
  if (!g) return;
  let html = '';
  for (let i = 0; i < 12; i++) {
    const rad = (i * 30 - 90) * Math.PI / 180;
    const isMajor = i % 3 === 0;
    const r1 = isMajor ? 35 : 38;
    const r2 = 43;
    const x1 = (50 + r1 * Math.cos(rad)).toFixed(2);
    const y1 = (50 + r1 * Math.sin(rad)).toFixed(2);
    const x2 = (50 + r2 * Math.cos(rad)).toFixed(2);
    const y2 = (50 + r2 * Math.sin(rad)).toFixed(2);
    html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${isMajor ? '#c8a55a' : '#6b4a1a'}" stroke-width="${isMajor ? 2.5 : 1.2}"/>`;
  }
  const numerals = [['XII', 0], ['III', 90], ['VI', 180], ['IX', 270]];
  for (const [n, deg] of numerals) {
    const rad = (deg - 90) * Math.PI / 180;
    const x = (50 + 28 * Math.cos(rad)).toFixed(2);
    const y = (50 + 28 * Math.sin(rad) + 2.5).toFixed(2);
    html += `<text x="${x}" y="${y}" text-anchor="middle" font-family="serif" font-size="8" fill="#c8a55a" font-style="italic">${n}</text>`;
  }
  g.innerHTML = html;
}

function updateClock(hour24) {
  const angle = (hour24 % 12) * 30;
  const hand = document.getElementById('clock-hour-hand');
  if (hand) hand.setAttribute('transform', `rotate(${angle}, 50, 50)`);
  const label = document.getElementById('clock-time-label');
  if (label) {
    const h = hour24 % 12 || 12;
    label.textContent = `${h}:00 ${hour24 < 12 ? 'AM' : 'PM'}`;
  }
}

/* ── Identity panel ─────────────────────────────────────────── */
function getPlayerIdentity() {
  return JSON.parse(localStorage.getItem('campaign_identity') || '{"name":"","color":"#8B2E2E"}');
}

function setPlayerIdentity(name, color) {
  localStorage.setItem('campaign_identity', JSON.stringify({ name, color }));
  updateIdentityDisplay();
}

function canWrite() {
  if (GithubAPI.getPersonalPAT()) return true;
  if (!GithubAPI.getPAT()) return false;
  const { name } = getPlayerIdentity();
  if (!name) return false;
  const members = CFG?.partyMembers || [];
  if (members.length === 0) return true;
  return members.some(m => m.name.toLowerCase() === name.toLowerCase());
}

function updateIdentityDisplay() {
  const { name, color } = getPlayerIdentity();
  const display = document.getElementById('identity-name-display');
  if (display) display.textContent = name || 'Set Identity';
  const btn = document.getElementById('identity-toggle');
  if (btn) {
    btn.style.borderColor = name ? color : '';
    btn.title = canWrite() ? 'Edit access granted' : (name ? 'Name not on player roster — view only' : 'Set your identity to edit');
  }
}

function refreshPatStatus() {
  const active = !!GithubAPI.getPersonalPAT();
  const statusEl = document.getElementById('identity-pat-status');
  const clearBtn = document.getElementById('identity-pat-clear');
  if (statusEl) {
    statusEl.textContent = active ? 'PAT active — full edit access' : '';
    statusEl.style.color = active ? 'var(--success-text, #2a5c2a)' : '';
  }
  if (clearBtn) clearBtn.classList.toggle('hidden', !active);
}

document.getElementById('identity-toggle')?.addEventListener('click', () => {
  const { name, color } = getPlayerIdentity();
  if (name) document.getElementById('identity-name-input').value = name;
  document.getElementById('identity-color-input').value = color || '#8B2E2E';
  document.getElementById('identity-preview-swatch').style.background = color || '#8B2E2E';
  refreshPatStatus();
  document.getElementById('identity-panel').classList.toggle('hidden');
});

document.getElementById('identity-color-input')?.addEventListener('input', e => {
  document.getElementById('identity-preview-swatch').style.background = e.target.value;
});

document.getElementById('identity-save')?.addEventListener('click', () => {
  const name = document.getElementById('identity-name-input').value.trim();
  const color = document.getElementById('identity-color-input').value;
  if (!name) { showBanner('Enter your character name.', 'error'); return; }
  setPlayerIdentity(name, color);
  document.getElementById('identity-panel').classList.add('hidden');
  if (canWrite()) {
    showBanner(`Welcome, ${name}! You have edit access.`, 'success');
  } else {
    showBanner(`Identity set: ${name}. Name not on roster — view only.`, 'info');
  }
});

document.getElementById('identity-pat-save')?.addEventListener('click', async () => {
  const pat = document.getElementById('identity-pat-input').value.trim();
  if (!pat) return;
  const btn = document.getElementById('identity-pat-save');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await GithubAPI.testPAT(pat);
    GithubAPI.setPersonalPAT(pat);
    document.getElementById('identity-pat-input').value = '';
    refreshPatStatus();
    updateIdentityDisplay();
    showBanner('PAT set — you have full edit access.', 'success');
  } catch (e) {
    showBanner('Invalid PAT — check the token and try again.', 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Set';
});

document.getElementById('identity-pat-clear')?.addEventListener('click', () => {
  GithubAPI.setPersonalPAT('');
  document.getElementById('identity-pat-input').value = '';
  refreshPatStatus();
  updateIdentityDisplay();
  showBanner('Personal PAT removed.', 'info');
});


/* ── Map controls ────────────────────────────────────────────── */
document.getElementById('pin-mode-btn').addEventListener('click', () => {
  if (!mapLoaded) return;
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  if (MapView.isWaypointMode()) {
    exitWaypointModeIfActive();
  } else {
    const scrubDay = _scrubDate || { year: CURRENT_DATE?.year || 1, month: CURRENT_DATE?.month || 1, week: CURRENT_DATE?.week || 1, day: CURRENT_DATE?.day || 1 };
    const dayMvt = Movements.getForDay(scrubDay.year, scrubDay.month, scrubDay.week, scrubDay.day);
    MapView.enableWaypointMode(dayMvt?.waypoints || [], dayMvt?.waypointColor || '#8b6914', () => renderWaypointList());
    const colorInput = document.getElementById('wp-color-input');
    if (colorInput) colorInput.value = dayMvt?.waypointColor || '#8b6914';
    document.getElementById('waypoint-panel')?.classList.remove('hidden');
    document.getElementById('pin-mode-btn').classList.add('active');
    renderWaypointList();
    showBanner('Click the map to add trail waypoints for this day.', 'info');
  }
});

document.getElementById('trail-toggle-btn').addEventListener('click', () => {
  const visible = MapView.toggleTrail(Movements.getAll(), _scrubDate, CFG);
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

/* ── Map scrubber ────────────────────────────────────────────── */
function updateScrubLabel() {
  const label = document.getElementById('scrub-date-label');
  if (!label || !_scrubDate || !CFG) return;
  const mn = (CFG.monthNames || [])[_scrubDate.month - 1] || `M${_scrubDate.month}`;
  const wn = (CFG.weekNames || [])[_scrubDate.week - 1] || `W${_scrubDate.week}`;
  label.textContent = `Y${_scrubDate.year} · ${mn} · ${wn} · D${_scrubDate.day}`;
}

function exitWaypointModeIfActive() {
  if (!MapView.isWaypointMode()) return;
  MapView.disableWaypointMode();
  document.getElementById('pin-mode-btn')?.classList.remove('active');
  document.getElementById('waypoint-panel')?.classList.add('hidden');
}

document.getElementById('scrub-prev-btn')?.addEventListener('click', () => {
  if (!_scrubDate || !CFG) return;
  exitWaypointModeIfActive();
  _scrubDate = { ...TimeCalc.add({ ..._scrubDate, hour: 0 }, { days: -1 }, CFG), hour: 0 };
  updateScrubLabel();
  if (mapLoaded) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
});

document.getElementById('scrub-next-btn')?.addEventListener('click', () => {
  if (!_scrubDate || !CFG) return;
  exitWaypointModeIfActive();
  _scrubDate = { ...TimeCalc.add({ ..._scrubDate, hour: 0 }, { days: 1 }, CFG), hour: 0 };
  updateScrubLabel();
  if (mapLoaded) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
});

/* ── Add Waypoint mode (map waypoint button) ────────────────── */
let _addPinCoords = null;
let _qpSelectedColor = '#6B3A2A';

document.getElementById('waypoint-mode-btn')?.addEventListener('click', () => {
  if (!mapLoaded) return;
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  if (MapView.isPinMode()) {
    MapView.disablePinMode();
    document.getElementById('waypoint-mode-btn').classList.remove('active');
    hideBanner();
  } else {
    MapView.enablePinMode((x, y) => {
      MapView.disablePinMode();
      document.getElementById('waypoint-mode-btn').classList.remove('active');
      _addPinCoords = { x, y };
      openQuickWaypointModal();
    });
    document.getElementById('waypoint-mode-btn').classList.add('active');
    showBanner('Click the map to place a new waypoint.', 'info');
  }
});

function openQuickWaypointModal() {
  document.getElementById('qp-title').value = '';
  document.getElementById('qp-desc').value = '';
  const d = CURRENT_DATE || { year: 1, month: 1, week: 1, day: 1, hour: 0 };
  document.querySelector('[name=qp-year]').value = d.year;
  setSelectValue(document.querySelector('[name=qp-month]'), d.month);
  setSelectValue(document.querySelector('[name=qp-week]'), d.week);
  setSelectValue(document.querySelector('[name=qp-day]'), d.day);
  setSelectValue(document.querySelector('[name=qp-hour]'), d.hour || 0);
  setQpColor((CFG && CFG.defaultEventColor) || '#6B3A2A');
  openModal('quick-waypoint-modal');
}

function setQpColor(hex) {
  _qpSelectedColor = hex;
  document.getElementById('qp-color-preview').style.background = hex;
  document.querySelectorAll('#qp-swatch-grid .color-swatch').forEach(s =>
    s.classList.toggle('selected', s.dataset.color === hex)
  );
}

document.getElementById('qp-cancel-btn')?.addEventListener('click', () => {
  closeModal('quick-waypoint-modal');
  _addPinCoords = null;
});
document.getElementById('quick-waypoint-modal')?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  closeModal('quick-waypoint-modal');
  _addPinCoords = null;
});

document.getElementById('qp-save-btn')?.addEventListener('click', async () => {
  const title = document.getElementById('qp-title').value.trim();
  if (!title) { showBanner('Title is required.', 'error'); return; }
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  const btn = document.getElementById('qp-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const data = {
      title,
      description: document.getElementById('qp-desc').value.trim(),
      year: +document.querySelector('[name=qp-year]').value,
      month: +document.querySelector('[name=qp-month]').value,
      week: +document.querySelector('[name=qp-week]').value,
      day: +document.querySelector('[name=qp-day]').value,
      hour: +document.querySelector('[name=qp-hour]').value,
      color: _qpSelectedColor,
      tags: [],
      mapX: _addPinCoords?.x ?? null,
      mapY: _addPinCoords?.y ?? null
    };
    await Events.add(data);
    appendActivityLog('event_add', `Added waypoint: "${title}"`);
    closeModal('quick-waypoint-modal');
    _addPinCoords = null;
    Calendar.render();
    if (mapLoaded && _scrubDate) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
    refreshTimeline();
    showBanner('Waypoint added!', 'success');
  } catch (e) { showBanner(e.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Add Waypoint';
});

/* ── Reposition Waypoint (from edit modal) ──────────────────── */
document.getElementById('reposition-pin-btn')?.addEventListener('click', () => {
  if (!editingEventId) return;
  closeModal('event-modal');
  _pendingMapPin = editingEventId;
  document.querySelector('.tab-btn[data-tab="map"]')?.click();
});

document.getElementById('save-and-waypoint-btn')?.addEventListener('click', () => {
  _saveAndAddWaypoint = true;
  document.getElementById('save-event-btn').click();
});

/* ── Edit event from map popup ──────────────────────────────── */
document.addEventListener('map:edit-event', e => {
  openViewModal(e.detail.id);
});

/* ── Waypoint panel controls (shown via Save + Waypoint) ────── */
document.getElementById('wp-color-input')?.addEventListener('input', e => {
  MapView.setPendingColor(e.target.value);
});
document.getElementById('wp-undo-btn')?.addEventListener('click', () => {
  MapView.undoLastWaypoint();
});
document.getElementById('wp-clear-btn')?.addEventListener('click', () => {
  MapView.clearPendingWaypoints();
});
document.getElementById('wp-cancel-btn')?.addEventListener('click', () => {
  exitWaypointModeIfActive();
  if (mapLoaded && _scrubDate) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
});
document.getElementById('wp-save-btn')?.addEventListener('click', async () => {
  if (!_scrubDate) return;
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  const inputs = document.querySelectorAll('#wp-list .wp-label-input');
  const waypoints = MapView.getPendingWaypoints().map((wp, i) => ({
    ...wp, label: inputs[i]?.value.trim() || ''
  }));
  const waypointColor = MapView.getPendingColor();
  try {
    await Movements.setDay(_scrubDate.year, _scrubDate.month, _scrubDate.week, _scrubDate.day, { waypoints, waypointColor });
    appendActivityLog('waypoints_save', `Saved ${waypoints.length} waypoint(s)`);
    exitWaypointModeIfActive();
    MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
    showBanner(`${waypoints.length} waypoint(s) saved!`, 'success');
  } catch (e) { showBanner(e.message, 'error'); }
});

/* ── Movement modal ──────────────────────────────────────────── */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openMovementModal(date) {
  _mvtDate = date;
  const mn = (CFG.monthNames || [])[date.month - 1] || `Month ${date.month}`;
  const wn = (CFG.weekNames || [])[date.week - 1] || `Week ${date.week}`;
  const dayNum = (date.week - 1) * CFG.daysPerWeek + date.day;
  document.getElementById('mvt-modal-date').textContent =
    `Year ${date.year} · ${mn} · ${wn} · Day ${dayNum}`;

  document.getElementById('mvt-start-loc').value = Movements.getStartLocation(date, CFG) || '';
  const existing = Movements.getForDay(date.year, date.month, date.week, date.day);
  document.getElementById('mvt-end-loc').value = existing?.endLocation || '';

  const table = document.getElementById('mvt-segments-table');
  table.innerHTML = '';
  const noMembers = (CFG.partyMembers || []).length === 0;
  document.getElementById('mvt-no-members-note').classList.toggle('hidden', !noMembers);
  for (const seg of (existing?.segments || [])) addSegmentRow(seg);

  renderMovementTimeline();
  openModal('mvt-modal');
}

function addSegmentRow(seg = {}) {
  const members = CFG.partyMembers || [];
  if (members.length === 0) return;
  const row = document.createElement('div');
  row.className = 'mvt-seg-row';

  const memberSel = document.createElement('select');
  memberSel.className = 'seg-member';
  members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === seg.memberId) opt.selected = true;
    memberSel.appendChild(opt);
  });

  const labelInp = document.createElement('input');
  labelInp.type = 'text';
  labelInp.className = 'seg-label';
  labelInp.placeholder = 'Activity';
  labelInp.value = seg.label || '';

  const startSel = document.createElement('select');
  startSel.className = 'seg-start';
  for (let h = 0; h < CFG.hoursPerDay; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = String(h).padStart(2, '0') + ':00';
    if (h === (seg.startHour || 0)) opt.selected = true;
    startSel.appendChild(opt);
  }

  const endSel = document.createElement('select');
  endSel.className = 'seg-end';
  for (let h = 1; h <= CFG.hoursPerDay; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h === CFG.hoursPerDay ? 'End of Day' : String(h).padStart(2, '0') + ':00';
    if (h === (seg.endHour != null ? seg.endHour : CFG.hoursPerDay)) opt.selected = true;
    endSel.appendChild(opt);
  }

  const rmBtn = document.createElement('button');
  rmBtn.type = 'button';
  rmBtn.className = 'mvt-rm-btn';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => { row.remove(); renderMovementTimeline(); });

  [memberSel, startSel, endSel].forEach(el => el.addEventListener('change', renderMovementTimeline));
  labelInp.addEventListener('input', renderMovementTimeline);

  row.append(memberSel, labelInp, startSel, endSel, rmBtn);
  document.getElementById('mvt-segments-table').appendChild(row);
  renderMovementTimeline();
}

function collectSegmentsFromForm() {
  return Array.from(document.querySelectorAll('#mvt-segments-table .mvt-seg-row')).map(row => ({
    memberId:  row.querySelector('.seg-member').value,
    label:     row.querySelector('.seg-label').value.trim(),
    startHour: +row.querySelector('.seg-start').value,
    endHour:   +row.querySelector('.seg-end').value
  })).filter(s => s.endHour > s.startHour);
}

function renderMovementTimeline() {
  const container = document.getElementById('mvt-timeline');
  if (!container) return;
  const members = CFG.partyMembers || [];
  const segments = collectSegmentsFromForm();
  const hours = CFG.hoursPerDay || 24;

  if (segments.length === 0) {
    container.innerHTML = '<div style="font-size:.78rem;color:var(--ink-light);padding:6px 4px">Add segments above to preview.</div>';
    return;
  }

  const byMember = {};
  for (const seg of segments) {
    (byMember[seg.memberId] = byMember[seg.memberId] || []).push(seg);
  }

  let html = '<div class="mvt-timeline"><div class="tl-hour-labels">';
  for (let h = 0; h < hours; h++) html += `<div class="tl-hour-tick">${h}</div>`;
  html += '</div>';

  for (const [memberId, segs] of Object.entries(byMember)) {
    const mb = members.find(m => m.id === memberId);
    const name = mb ? mb.name : memberId;
    const color = mb ? mb.color : '#888';
    html += `<div class="tl-row"><div class="tl-name" title="${escHtml(name)}">${escHtml(name)}</div><div class="tl-track">`;
    for (const seg of segs) {
      const left = (seg.startHour / hours) * 100;
      const width = ((seg.endHour - seg.startHour) / hours) * 100;
      html += `<div class="tl-seg" style="left:${left}%;width:${width}%;background:${color}" title="${escHtml(seg.label || name)}"></div>`;
    }
    html += '</div></div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

document.getElementById('mvt-add-seg-btn')?.addEventListener('click', () => addSegmentRow());

document.getElementById('mvt-save-btn')?.addEventListener('click', async () => {
  if (!_mvtDate) return;
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  const segments = collectSegmentsFromForm();
  const endLoc = document.getElementById('mvt-end-loc').value.trim() || null;
  try {
    await Movements.setDay(_mvtDate.year, _mvtDate.month, _mvtDate.week, _mvtDate.day, { segments, endLocation: endLoc });
    appendActivityLog('movement_save', `Movement: Y${_mvtDate.year} M${_mvtDate.month} W${_mvtDate.week} D${(_mvtDate.week-1)*CFG.daysPerWeek+_mvtDate.day}`);
    closeModal('mvt-modal');
    Calendar.render();
    showBanner('Movement saved!', 'success');
  } catch (e) { showBanner(e.message, 'error'); }
});

document.getElementById('mvt-clear-btn')?.addEventListener('click', async () => {
  if (!_mvtDate) return;
  if (!confirm('Clear all movement data for this day?')) return;
  if (!canWrite()) { showBanner('Set your identity to a recognized player name to edit.', 'error'); return; }
  try {
    await Movements.clearDay(_mvtDate.year, _mvtDate.month, _mvtDate.week, _mvtDate.day);
    appendActivityLog('movement_clear', `Cleared movement: Y${_mvtDate.year} M${_mvtDate.month} W${_mvtDate.week} D${(_mvtDate.week-1)*CFG.daysPerWeek+_mvtDate.day}`);
    closeModal('mvt-modal');
    Calendar.render();
    showBanner('Movement cleared.', 'success');
  } catch (e) { showBanner(e.message, 'error'); }
});

document.getElementById('mvt-cancel-btn')?.addEventListener('click', () => closeModal('mvt-modal'));
document.getElementById('mvt-modal')?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeModal('mvt-modal'));

/* ── Activity Log ───────────────────────────────────────────── */
function appendActivityLog(action, details) {
  const { name, color } = getPlayerIdentity();
  ActivityLog.append({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    playerName: name || 'Unknown',
    playerColor: color || '#888',
    action,
    details
  });
  ActivityLog.save().catch(() => {});
}

function renderLogTab() {
  const entries = ActivityLog.getAll();
  const list = document.getElementById('log-list');
  if (!list) return;
  if (entries.length === 0) {
    list.innerHTML = '<p class="log-empty">No activity recorded yet.</p>';
    return;
  }
  list.innerHTML = entries.map(e => {
    const ts = new Date(e.timestamp).toLocaleString();
    const color = e.playerColor || '#888';
    return `<div class="log-entry">
      <span class="log-dot" style="background:${color}"></span>
      <span class="log-player" style="color:${color}">${escHtml(e.playerName)}</span>
      <span class="log-details">${escHtml(e.details)}</span>
      <span class="log-time">${escHtml(ts)}</span>
    </div>`;
  }).join('');
}

document.getElementById('refresh-log-btn')?.addEventListener('click', async () => {
  try {
    const { content } = await GithubAPI.readFile('data/activity-log.json');
    ActivityLog.importJSON(content);
    renderLogTab();
  } catch (e) { showBanner('Failed to refresh log.', 'error'); }
});

/* ── Timeline tab ───────────────────────────────────────────── */
function initTimeline() {
  if (!timelineLoaded) {
    TimelineView.init(
      document.getElementById('timeline-scroll'),
      CFG,
      date => { _openedFromTimeline = true; openAddModal({ ...date }); },
      id => openViewModal(id)
    );
    timelineLoaded = true;
  }
  TimelineView.setData(Events.getAll(), CURRENT_DATE);
  TimelineView.render();
  TimelineView.scrollToNow();
}

function refreshTimeline() {
  if (!timelineLoaded) return;
  TimelineView.setData(Events.getAll(), CURRENT_DATE);
  TimelineView.render();
}

document.getElementById('tl-zoom-in')?.addEventListener('click', () => TimelineView.zoom(1.6));
document.getElementById('tl-zoom-out')?.addEventListener('click', () => TimelineView.zoom(1 / 1.6));
document.getElementById('tl-scroll-now')?.addEventListener('click', () => TimelineView.scrollToNow());

/* ── Waypoint-for-event mode (from timeline / save+waypoint flow) */
function enablePinForEvent(eventId) {
  MapView.enablePinMode(async (x, y) => {
    MapView.disablePinMode();
    try {
      const ev = Events.getAll().find(e => e.id === eventId);
      if (ev) {
        await Events.update(eventId, { ...ev, mapX: x, mapY: y });
        if (mapLoaded && _scrubDate) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
        showBanner('Waypoint placed!', 'success');
      }
    } catch (e) { showBanner(e.message, 'error'); }
  });
  showBanner('Click the map to place the waypoint, or press Escape to skip.', 'info');
}

/* ── Map scrub-to-day (click waypoint/trail on other day) ─────── */
document.addEventListener('map:scrub-to-day', e => {
  exitWaypointModeIfActive();
  _scrubDate = { ...e.detail, hour: 0 };
  updateScrubLabel();
  if (mapLoaded) MapView.renderScrubbed(Events.getAll(), Movements.getAll(), _scrubDate, CFG);
});

/* ── Live update poll ───────────────────────────────────────── */
let _lastKnownSHAs = {};

async function checkForUpdates() {
  if (!CFG) return;
  try {
    const files = ['data/events.json', 'data/current-date.json', 'data/movements.json'];
    const results = await Promise.all(files.map(f =>
      fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${f}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    ));
    let changed = false;
    results.forEach((data, i) => {
      if (!data) return;
      const key = files[i];
      if (_lastKnownSHAs[key] && _lastKnownSHAs[key] !== data.sha) changed = true;
      _lastKnownSHAs[key] = data.sha;
    });
    if (changed) showUpdateBanner();
  } catch (_) {}
}

function showUpdateBanner() {
  const el = document.getElementById('banner');
  el.textContent = '📜 Updates available — click to refresh';
  el.className = 'banner banner-info';
  el.classList.remove('hidden');
  el.style.cursor = 'pointer';
  el.onclick = () => { el.style.cursor = ''; el.onclick = null; location.reload(); };
}

function startUpdatePoll() {
  const files = ['data/events.json', 'data/current-date.json', 'data/movements.json'];
  Promise.all(files.map(f =>
    fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${f}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    }).then(r => r.ok ? r.json() : null).catch(() => null)
  )).then(results => {
    results.forEach((data, i) => { if (data) _lastKnownSHAs[files[i]] = data.sha; });
  });
  setInterval(checkForUpdates, 30000);
}

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
  buildMonthSelect('qp-month');
  buildWeekSelect('start-week');
  buildWeekSelect('end-week');
  buildWeekSelect('qp-week');
  buildDaySelect('start-day');
  buildDaySelect('end-day');
  buildDaySelect('qp-day');
  buildHourSelect('start-hour');
  buildHourSelect('end-hour');
  buildHourSelect('qp-hour');
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
  initClock();
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
  const qpGrid = document.getElementById('qp-swatch-grid');
  if (!qpGrid) return;
  qpGrid.innerHTML = COLOR_SWATCHES.map(c =>
    `<div class="color-swatch" data-color="${c}" style="background:${c}" title="${c}"></div>`
  ).join('');
  qpGrid.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', () => setQpColor(s.dataset.color));
  });
}
