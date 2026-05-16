const MapView = (() => {
  let _map = null;
  let _overlay = null;
  let _pinLayers = [];
  let _chainLayers = [];
  let _container = null;
  let _cfg = null;
  let _pinModeActive = false;
  let _pinCallback = null;
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
    if (!_pinModeActive) return;
    if (_pinCallback) _pinCallback(x, y);
  }

  /* ── Icon factories ────────────────────────────────────────── */

  // Teardrop pin for standalone events
  function _eventPinIcon(color) {
    const c = escHtml(color);
    return L.divIcon({
      className: '',
      html: `<svg viewBox="0 0 24 30" width="20" height="26" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 1C5.9 1 1 5.9 1 12C1 18.6 12 29 12 29C12 29 23 18.6 23 12C23 5.9 18.1 1 12 1Z"
          fill="${c}" stroke="#2c1810" stroke-width="1.5"/>
        <circle cx="12" cy="11.5" r="4" fill="rgba(255,255,255,0.3)"/>
      </svg>`,
      iconSize: [20, 26],
      iconAnchor: [10, 26],
      popupAnchor: [0, -28]
    });
  }

  // Diamond for party location
  function _diamondIcon(color, size, borderColor) {
    const b = borderColor || '#2c1810';
    const pad = Math.ceil(size * 0.35);
    const total = size + pad * 2;
    return L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;background:${escHtml(color)};border:2px solid ${escHtml(b)};transform:rotate(45deg);box-sizing:border-box;position:absolute;top:${pad}px;left:${pad}px;box-shadow:0 1px 5px rgba(0,0,0,0.5)"></div>`,
      iconSize: [total, total],
      iconAnchor: [total / 2, total / 2],
      popupAnchor: [0, -(total / 2 + 4)]
    });
  }

  /* ── Event pin markers ─────────────────────────────────────── */
  function renderPins(events, cfg) {
    _pinLayers.forEach(l => _map.removeLayer(l));
    _pinLayers = [];
    if (!_map) return;

    const pinned = events.filter(ev => ev.mapX != null && ev.mapY != null && ev.markerType !== 'none');

    // Group by exact pixel location
    const groups = new Map();
    for (const ev of pinned) {
      const key = `${ev.mapX},${ev.mapY}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }

    for (const [, evList] of groups) {
      if (cfg) {
        evList.sort((a, b) =>
          TimeCalc.toAbsolute({ year: a.year, month: a.month, week: a.week, day: a.day, hour: a.hour || 0 }, cfg) -
          TimeCalc.toAbsolute({ year: b.year, month: b.month, week: b.week, day: b.day, hour: b.hour || 0 }, cfg)
        );
      }

      const representative = evList[evList.length - 1]; // most recent = display color
      const color = representative.color || (cfg && cfg.defaultEventColor) || '#6B3A2A';
      const hasWaypoint = evList.some(e => e.markerType === 'waypoint');
      const first = evList[0];

      let marker;
      if (hasWaypoint) {
        // Waypoints render as circles
        marker = L.circleMarker([first.mapY, first.mapX], {
          radius: 9,
          fillColor: color,
          color: '#2c1810',
          weight: 1.5,
          fillOpacity: 0.9
        }).addTo(_map);
      } else {
        // Standalone events render as teardrop pins
        marker = L.marker([first.mapY, first.mapX], {
          icon: _eventPinIcon(color),
          zIndexOffset: 50
        }).addTo(_map);
      }

      marker.bindPopup(_buildPopup(evList, cfg), { maxWidth: 280, maxHeight: 360 });

      marker.on('popupopen', () => {
        document.querySelectorAll('.popup-goto-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('map:goto-event', { detail: { id: btn.dataset.eventId } }));
          });
        });
        document.querySelectorAll('.popup-edit-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('map:edit-event', { detail: { id: btn.dataset.eventId } }));
          });
        });
        document.querySelectorAll('.popup-toggle-type-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('map:toggle-marker-type', { detail: { id: btn.dataset.eventId } }));
          });
        });
      });

      _pinLayers.push(marker);
    }
  }

  function _buildPopup(evList, cfg) {
    let html = '<div class="map-popup">';
    evList.forEach((ev, i) => {
      const dateStr = cfg ? TimeCalc.format(ev, cfg) : '';
      const desc = _renderLinks(ev.description || '');
      const isWp = ev.markerType === 'waypoint';
      if (i > 0) html += '<hr class="popup-divider">';
      html += `<div class="popup-stack-item">
        <strong>${escHtml(ev.title)}</strong>
        <div class="popup-date">${dateStr}</div>
        ${ev.location ? `<div class="popup-location">${escHtml(ev.location)}</div>` : ''}
        ${desc ? `<div class="popup-desc">${desc}</div>` : ''}
        <div class="popup-actions">
          <button class="popup-goto-btn" data-event-id="${ev.id}">Calendar</button>
          <button class="popup-edit-btn" data-event-id="${ev.id}">Edit</button>
          <button class="popup-toggle-type-btn" data-event-id="${ev.id}">${isWp ? 'Unlink from Chain' : 'Add to Chain'}</button>
        </div>
      </div>`;
    });
    html += '</div>';
    return html;
  }

  /* ── Waypoint chain (chronological event-waypoints) ──────────── */
  function renderWaypointChain(events, cfg, currentDate) {
    _chainLayers.forEach(l => _map.removeLayer(l));
    _chainLayers = [];
    if (!_map || !cfg) return;

    const waypoints = events
      .filter(e => e.markerType === 'waypoint' && e.mapX != null && e.mapY != null)
      .sort((a, b) =>
        TimeCalc.toAbsolute({ year: a.year, month: a.month, week: a.week, day: a.day, hour: a.hour || 0 }, cfg) -
        TimeCalc.toAbsolute({ year: b.year, month: b.month, week: b.week, day: b.day, hour: b.hour || 0 }, cfg)
      );

    const points = waypoints.map(e => [e.mapY, e.mapX]);

    // Current location is the chain's terminal point
    if (currentDate && currentDate.locationX != null && currentDate.locationY != null) {
      points.push([currentDate.locationY, currentDate.locationX]);
    }

    if (points.length >= 2) {
      _chainLayers.push(
        L.polyline(points, { color: '#c8a55a', weight: 2, opacity: 0.75 }).addTo(_map)
      );
    }
  }

  /* ── Full scrubbed render ──────────────────────────────────── */
  function renderScrubbed(events, scrubDate, cfg, currentDate) {
    if (!_map || !scrubDate || !cfg) return;
    const scrubAbs = TimeCalc.toAbsolute({ ...scrubDate, hour: 23 }, cfg);
    const visible = events.filter(ev =>
      TimeCalc.toAbsolute({ year: ev.year, month: ev.month, week: ev.week, day: ev.day, hour: ev.hour || 0 }, cfg) <= scrubAbs
    );
    renderPins(visible, cfg);
    renderWaypointChain(visible, cfg, currentDate);
  }

  /* ── Current party location marker (diamond) ───────────────── */
  function renderCurrentLocation(currentDate) {
    if (_locationLayer) { _map.removeLayer(_locationLayer); _locationLayer = null; }
    if (!_map || !currentDate || currentDate.locationX == null || currentDate.locationY == null) return;

    _locationLayer = L.marker([currentDate.locationY, currentDate.locationX], {
      icon: _diamondIcon('#00CED1', 16, '#004a4a'),
      zIndexOffset: 1000,
      interactive: false
    }).addTo(_map);

    if (currentDate.currentLocation) {
      _locationLayer.bindTooltip(escHtml(currentDate.currentLocation), {
        permanent: true, direction: 'top', offset: [0, -14], className: 'loc-tooltip'
      });
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
    renderPins, renderScrubbed, renderWaypointChain, renderCurrentLocation,
    enablePinMode, disablePinMode, isPinMode,
    invalidateSize
  };
})();
