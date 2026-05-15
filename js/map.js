const MapView = (() => {
  let _map = null;
  let _overlay = null;
  let _trailLayer = null;
  let _pinLayers = [];
  let _waypointLayers = [];
  let _container = null;
  let _cfg = null;
  let _pinModeActive = false;
  let _pinCallback = null;
  let _wpModeActive = false;
  let _wpModeCallback = null;
  let _pendingWaypoints = [];
  let _trailVisible = false;

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

  /* ── Movement waypoint trail ───────────────────────────────── */
  function _buildTrailLatLngs(movements, scrubDate, cfg) {
    const scrubAbs = TimeCalc.toAbsolute({ ...scrubDate, hour: 23 }, cfg);
    const sorted = [...movements]
      .filter(m => m.waypoints && m.waypoints.length > 0 &&
        TimeCalc.toAbsolute({ year: m.year, month: m.month, week: m.week, day: m.day, hour: 0 }, cfg) <= scrubAbs
      )
      .sort((a, b) =>
        TimeCalc.toAbsolute({ year: a.year, month: a.month, week: a.week, day: a.day, hour: 0 }, cfg) -
        TimeCalc.toAbsolute({ year: b.year, month: b.month, week: b.week, day: b.day, hour: 0 }, cfg)
      );
    const latlngs = [];
    for (const m of sorted) {
      for (const wp of m.waypoints) latlngs.push([wp.y, wp.x]);
    }
    return latlngs;
  }

  function renderTrail(movements, scrubDate, cfg) {
    if (_trailLayer) { _map.removeLayer(_trailLayer); _trailLayer = null; }
    if (!_map || !_trailVisible || !scrubDate || !cfg) return;
    const latlngs = _buildTrailLatLngs(movements, scrubDate, cfg);
    if (latlngs.length < 2) return;
    _trailLayer = L.polyline(latlngs, {
      color: '#8b6914',
      weight: 2,
      dashArray: '6,4',
      opacity: 0.8
    }).addTo(_map);
  }

  function toggleTrail(movements, scrubDate, cfg) {
    _trailVisible = !_trailVisible;
    renderTrail(movements, scrubDate, cfg);
    return _trailVisible;
  }

  /* ── Waypoint markers (numbered) ───────────────────────────── */
  function _makeWpIcon(num) {
    return L.divIcon({
      html: `<div class="wp-marker">${num}</div>`,
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
      const m = L.marker([wp.y, wp.x], { icon: _makeWpIcon(i + 1), interactive: false }).addTo(_map);
      _waypointLayers.push(m);
    });
  }

  function renderDayWaypoints(waypoints) {
    _waypointLayers.forEach(l => _map.removeLayer(l));
    _waypointLayers = [];
    if (!_map || !waypoints || waypoints.length === 0) return;
    waypoints.forEach((wp, i) => {
      const m = L.marker([wp.y, wp.x], { icon: _makeWpIcon(i + 1), interactive: !!wp.label }).addTo(_map);
      if (wp.label) m.bindTooltip(escHtml(wp.label));
      _waypointLayers.push(m);
    });
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
    if (!_wpModeActive) {
      const dayMvt = movements.find(m =>
        m.year === scrubDate.year && m.month === scrubDate.month &&
        m.week === scrubDate.week && m.day === scrubDate.day
      );
      renderDayWaypoints(dayMvt?.waypoints || []);
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
  function enableWaypointMode(existingWaypoints, callback) {
    _wpModeActive = true;
    _pendingWaypoints = [...(existingWaypoints || [])];
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

  function getPendingWaypoints() { return [..._pendingWaypoints]; }

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
    renderDayWaypoints, renderScrubbed,
    enablePinMode, disablePinMode, isPinMode,
    enableWaypointMode, disableWaypointMode, isWaypointMode,
    undoLastWaypoint, clearPendingWaypoints, getPendingWaypoints,
    invalidateSize
  };
})();
