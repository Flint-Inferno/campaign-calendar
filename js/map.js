const MapView = (() => {
  let _map = null;
  let _overlay = null;
  let _trailLayers = [];
  let _pinLayers = [];
  let _waypointLayers = [];
  let _container = null;
  let _cfg = null;
  let _pinModeActive = false;
  let _pinCallback = null;
  let _wpModeActive = false;
  let _wpModeCallback = null;
  let _pendingWaypoints = [];
  let _pendingColor = '#8b6914';
  let _trailVisible = false;
  let _locationLayer = null;

  const MAP_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/data/map.png`;

  function init(container, cfg) {
    _container = container;
    _cfg = cfg;
    if (_map) { _map.remove(); _map = null; }
  }

  function setConfig(cfg) { _cfg = cfg; }

  function loadMap() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        _map = L.map(_container, {
          crs: L.CRS.Simple,
          minZoom: -3,
          maxZoom: 3,
          zoomSnap: 0.25
        });
        const bounds = [[0, 0], [h, w]];
        _overlay = L.imageOverlay(MAP_URL, bounds).addTo(_map);
        _map.fitBounds(bounds);
        _map.on('click', onMapClick);
        resolve();
      };
      img.onerror = () => reject(new Error('map-missing'));
      img.src = MAP_URL + '?t=' + Date.now();
    });
  }

  function onMapClick(e) {
    const x = Math.round(e.latlng.lng);
    const y = Math.round(e.latlng.lat);
    if (_wpModeActive) {
      _pendingWaypoints.push({ x, y, label: '' });
      _refreshWaypointMarkers();
      if (_wpModeCallback) _wpModeCallback([..._pendingWaypoints]);
      return;
    }
    if (!_pinModeActive) return;
    if (_pinCallback) _pinCallback(x, y);
  }

  /* ── Event pin markers ─────────────────────────────────────── */
  function renderPins(events) {
    _pinLayers.forEach(l => _map.removeLayer(l));
    _pinLayers = [];
    if (!_map) return;
    const pinned = events.filter(ev => ev.mapX != null && ev.mapY != null);
    for (const ev of pinned) {
      const color = ev.color || (_cfg && _cfg.defaultEventColor) || '#6B3A2A';
      const marker = L.circleMarker([ev.mapY, ev.mapX], {
        radius: 9,
        fillColor: color,
        color: '#2c1810',
        weight: 1.5,
        fillOpacity: 0.9
      }).addTo(_map);
      const desc = _renderLinks(ev.description || '');
      const dateStr = _cfg ? TimeCalc.format(ev, _cfg) : '';
      marker.bindPopup(`
        <div class="map-popup">
          <strong>${escHtml(ev.title)}</strong>
          <div class="popup-date">${dateStr}</div>
          ${desc ? `<div class="popup-desc">${desc}</div>` : ''}
          <button class="popup-goto-btn" data-event-id="${ev.id}">View on Calendar</button>
        </div>
      `);
      marker.on('popupopen', () => {
        document.querySelectorAll('.popup-goto-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.eventId;
            document.dispatchEvent(new CustomEvent('map:goto-event', { detail: { id } }));
          });
        });
      });
      _pinLayers.push(marker);
    }
  }

  /* ── Movement waypoint trail (per-day colored segments) ─────── */
  function _dayKey(m) { return `${m.year}-${m.month}-${m.week}-${m.day}`; }
  function _scrubKey(s) { return s ? `${s.year}-${s.month}-${s.week}-${s.day}` : ''; }

  function _dispatchScrubTo(day) {
    document.dispatchEvent(new CustomEvent('map:scrub-to-day', {
      detail: { year: day.year, month: day.month, week: day.week, day: day.day }
    }));
  }

  function renderTrail(movements, scrubDate, cfg) {
    _trailLayers.forEach(l => _map.removeLayer(l));
    _trailLayers = [];
    if (!_map || !_trailVisible || !cfg) return;

    const sorted = [...movements]
      .filter(m => m.waypoints && m.waypoints.length > 0)
      .sort((a, b) =>
        TimeCalc.toAbsolute({ year: a.year, month: a.month, week: a.week, day: a.day, hour: 0 }, cfg) -
        TimeCalc.toAbsolute({ year: b.year, month: b.month, week: b.week, day: b.day, hour: 0 }, cfg)
      );

    const activeKey = _scrubKey(scrubDate);

    for (let i = 0; i < sorted.length; i++) {
      const day = sorted[i];
      const isActive = _dayKey(day) === activeKey;
      const color = isActive ? (day.waypointColor || '#8b6914') : '#888';
      const opacity = isActive ? 0.9 : 0.25;
      const weight = isActive ? 2.5 : 1.5;

      if (day.waypoints.length >= 2) {
        const latlngs = day.waypoints.map(wp => [wp.y, wp.x]);
        const line = L.polyline(latlngs, { color, weight, opacity }).addTo(_map);
        if (!isActive) line.on('click', () => _dispatchScrubTo(day));
        _trailLayers.push(line);
      }

      if (i < sorted.length - 1) {
        const last = day.waypoints[day.waypoints.length - 1];
        const next = sorted[i + 1].waypoints[0];
        _trailLayers.push(
          L.polyline([[last.y, last.x], [next.y, next.x]], {
            color: '#999', weight: 1, dashArray: '4,7', opacity: 0.45
          }).addTo(_map)
        );
      }
    }
  }

  function toggleTrail(movements, scrubDate, cfg) {
    _trailVisible = !_trailVisible;
    renderTrail(movements, scrubDate, cfg);
    return _trailVisible;
  }

  /* ── Waypoint markers (numbered, colored) ──────────────────── */
  function _makeWpIcon(num, color) {
    const bg = color || '#8b6914';
    return L.divIcon({
      html: `<div class="wp-marker" style="background:${bg}">${num}</div>`,
      className: 'wp-marker-wrap',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function _refreshWaypointMarkers() {
    _waypointLayers.forEach(l => _map.removeLayer(l));
    _waypointLayers = [];
    if (!_map) return;
    _pendingWaypoints.forEach((wp, i) => {
      const m = L.marker([wp.y, wp.x], {
        icon: _makeWpIcon(i + 1, _pendingColor),
        interactive: false
      }).addTo(_map);
      _waypointLayers.push(m);
    });
  }

  function renderAllWaypoints(movements, scrubDate) {
    _waypointLayers.forEach(l => _map.removeLayer(l));
    _waypointLayers = [];
    if (!_map) return;
    const activeKey = _scrubKey(scrubDate);
    const days = movements.filter(m => m.waypoints && m.waypoints.length > 0);
    for (const day of days) {
      const isActive = _dayKey(day) === activeKey;
      const color = isActive ? (day.waypointColor || '#8b6914') : '#aaa';
      day.waypoints.forEach((wp, i) => {
        const icon = _makeWpIcon(i + 1, color);
        const m = L.marker([wp.y, wp.x], { icon, interactive: true, opacity: isActive ? 1 : 0.35 }).addTo(_map);
        if (wp.label) m.bindTooltip(escHtml(wp.label));
        if (!isActive) m.on('click', () => _dispatchScrubTo(day));
        _waypointLayers.push(m);
      });
    }
  }

  /* ── Full scrubbed render ──────────────────────────────────── */
  function renderScrubbed(events, movements, scrubDate, cfg) {
    if (!_map || !scrubDate || !cfg) return;
    const scrubAbs = TimeCalc.toAbsolute({ ...scrubDate, hour: 23 }, cfg);
    const visible = events.filter(ev =>
      TimeCalc.toAbsolute({ year: ev.year, month: ev.month, week: ev.week, day: ev.day, hour: ev.hour || 0 }, cfg) <= scrubAbs
    );
    renderPins(visible);
    renderTrail(movements, scrubDate, cfg);
    if (!_wpModeActive) renderAllWaypoints(movements, scrubDate);
  }

  /* ── Current party location marker ────────────────────────── */
  function renderCurrentLocation(currentDate) {
    if (_locationLayer) { _map.removeLayer(_locationLayer); _locationLayer = null; }
    if (!_map || !currentDate || currentDate.locationX == null || currentDate.locationY == null) return;
    const icon = L.divIcon({
      html: `<div class="loc-marker"><span class="loc-pulse"></span>⚑</div>`,
      className: 'loc-marker-wrap',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    _locationLayer = L.marker([currentDate.locationY, currentDate.locationX], { icon, zIndexOffset: 1000 }).addTo(_map);
    if (currentDate.currentLocation) {
      _locationLayer.bindTooltip(escHtml(currentDate.currentLocation), { permanent: true, direction: 'top', offset: [0, -14], className: 'loc-tooltip' });
    }
  }

  /* ── Pin mode ──────────────────────────────────────────────── */
  function enablePinMode(callback) {
    _pinModeActive = true;
    _pinCallback = callback;
    if (_container) _container.style.cursor = 'crosshair';
  }

  function disablePinMode() {
    _pinModeActive = false;
    _pinCallback = null;
    if (_container) _container.style.cursor = '';
  }

  function isPinMode() { return _pinModeActive; }

  /* ── Waypoint mode ─────────────────────────────────────────── */
  function enableWaypointMode(existingWaypoints, existingColor, callback) {
    _wpModeActive = true;
    _pendingWaypoints = [...(existingWaypoints || [])];
    _pendingColor = existingColor || '#8b6914';
    _wpModeCallback = callback;
    if (_container) _container.style.cursor = 'crosshair';
    _refreshWaypointMarkers();
  }

  function disableWaypointMode() {
    _wpModeActive = false;
    _wpModeCallback = null;
    _waypointLayers.forEach(l => _map.removeLayer(l));
    _waypointLayers = [];
    _pendingWaypoints = [];
    _pendingColor = '#8b6914';
    if (_container) _container.style.cursor = '';
  }

  function isWaypointMode() { return _wpModeActive; }

  function undoLastWaypoint() {
    if (_pendingWaypoints.length === 0) return;
    _pendingWaypoints.pop();
    _refreshWaypointMarkers();
    if (_wpModeCallback) _wpModeCallback([..._pendingWaypoints]);
  }

  function clearPendingWaypoints() {
    _pendingWaypoints = [];
    _refreshWaypointMarkers();
    if (_wpModeCallback) _wpModeCallback([]);
  }

  function setPendingColor(color) {
    _pendingColor = color || '#8b6914';
    _refreshWaypointMarkers();
  }

  function getPendingWaypoints() { return [..._pendingWaypoints]; }
  function getPendingColor() { return _pendingColor; }

  /* ── Utilities ─────────────────────────────────────────────── */
  function invalidateSize() {
    if (_map) _map.invalidateSize();
  }

  function _renderLinks(text) {
    return escHtml(text).replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      (_, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`
    );
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    init, setConfig, loadMap,
    renderPins, renderTrail, toggleTrail,
    renderAllWaypoints, renderScrubbed, renderCurrentLocation,
    enablePinMode, disablePinMode, isPinMode,
    enableWaypointMode, disableWaypointMode, isWaypointMode,
    undoLastWaypoint, clearPendingWaypoints, getPendingWaypoints,
    setPendingColor, getPendingColor,
    invalidateSize
  };
})();
