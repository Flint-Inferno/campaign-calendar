const MapView = (() => {
  let _map = null;
  let _overlay = null;
  let _trailLayer = null;
  let _pinLayers = [];
  let _container = null;
  let _cfg = null;
  let _pinModeActive = false;
  let _pinCallback = null;
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
    if (!_pinModeActive) return;
    const x = Math.round(e.latlng.lng);
    const y = Math.round(e.latlng.lat);
    if (_pinCallback) _pinCallback(x, y);
  }

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
      const desc = renderLinks(ev.description || '');
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

  function renderTrail(events) {
    if (_trailLayer) { _map.removeLayer(_trailLayer); _trailLayer = null; }
    if (!_map || !_trailVisible) return;
    const sorted = events
      .filter(ev => ev.mapX != null && ev.mapY != null)
      .sort((a, b) => TimeCalc.compare(a, b, _cfg));
    if (sorted.length < 2) return;
    const latlngs = sorted.map(ev => [ev.mapY, ev.mapX]);
    _trailLayer = L.polyline(latlngs, {
      color: '#8b6914',
      weight: 2,
      dashArray: '6,4',
      opacity: 0.8
    }).addTo(_map);
  }

  function toggleTrail(events) {
    _trailVisible = !_trailVisible;
    renderTrail(events);
    return _trailVisible;
  }

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

  function invalidateSize() {
    if (_map) _map.invalidateSize();
  }

  function renderLinks(text) {
    return escHtml(text).replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      (_, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`
    );
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init, setConfig, loadMap, renderPins, renderTrail, toggleTrail, enablePinMode, disablePinMode, isPinMode, invalidateSize };
})();
