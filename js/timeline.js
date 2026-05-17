const TimelineView = (() => {
  let _cfg = null;
  let _events = [];
  let _currentDate = null;
  let _pph = 2;
  let _container = null;
  let _onDateClick = null;
  let _onEventClick = null;
  let _zoomInitialized = false;
  let _addArmed = false;

  const PAD = 60;
  const MIN_PPH = 0.05;
  const MAX_PPH = 24;
  const INIT_DAYS_SPAN = 50;

  function init(container, cfg, onDateClick, onEventClick) {
    _container = container;
    _cfg = cfg;
    _onDateClick = onDateClick;
    _onEventClick = onEventClick;
    _zoomInitialized = false;
  }

  function setData(events, currentDate) {
    _events = events;
    _currentDate = currentDate;
  }

  function _minMaxAbs() {
    const nowAbs = _currentDate ? TimeCalc.toAbsolute(_currentDate, _cfg) : 0;
    const buffer = 25 * _cfg.hoursPerDay;
    const absList = [nowAbs - buffer, nowAbs + buffer];
    for (const ev of _events) {
      absList.push(TimeCalc.toAbsolute({ year: ev.year, month: ev.month, week: ev.week, day: ev.day, hour: ev.hour || 0 }, _cfg));
      if (ev.endYear != null) {
        absList.push(TimeCalc.toAbsolute({ year: ev.endYear, month: ev.endMonth, week: ev.endWeek, day: ev.endDay, hour: ev.endHour || 0 }, _cfg));
      }
    }
    const rawMin = Math.min(...absList);
    const rawMax = Math.max(...absList);
    return { min: Math.max(0, rawMin), max: rawMax + 1 };
  }

  function _absToY(abs, minAbs) {
    return PAD + (abs - minAbs) * _pph;
  }

  function _yToAbs(y, minAbs) {
    return Math.round((y - PAD) / _pph) + minAbs;
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _renderDividers(inner, minAbs, maxAbs) {
    const hpm = _cfg.weeksPerMonth * _cfg.daysPerWeek * _cfg.hoursPerDay;
    const hpy = hpm * _cfg.monthsPerYear;
    const firstBoundary = Math.ceil(minAbs / hpm) * hpm;
    for (let abs = firstBoundary; abs <= maxAbs; abs += hpm) {
      const date = TimeCalc.fromAbsolute(abs, _cfg);
      const isYear = abs % hpy === 0;
      const y = _absToY(abs, minAbs);

      const div = document.createElement('div');
      div.className = 'tl-month-div' + (isYear ? ' is-year' : '');
      div.style.top = y + 'px';

      const label = document.createElement('span');
      label.className = 'tl-month-div-label';
      const monthName = (_cfg.monthNames || [])[date.month - 1] || `Month ${date.month}`;
      label.textContent = isYear ? `Year ${date.year}` : monthName;
      div.appendChild(label);

      inner.appendChild(div);
    }
  }

  function render() {
    if (!_container || !_cfg) return;

    if (!_zoomInitialized && _container.clientHeight > 0) {
      _pph = _container.clientHeight / (INIT_DAYS_SPAN * _cfg.hoursPerDay);
      _zoomInitialized = true;
    }

    const { min: minAbs, max: maxAbs } = _minMaxAbs();
    const trackH = Math.max(200, PAD * 2 + (maxAbs - minAbs) * _pph);

    _container.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'tl-inner';
    inner.style.height = trackH + 'px';
    _container.appendChild(inner);

    const cl = document.createElement('div');
    cl.className = 'tl-center-line';
    inner.appendChild(cl);

    _renderDividers(inner, minAbs, maxAbs);

    if (_currentDate) {
      const nowY = _absToY(TimeCalc.toAbsolute(_currentDate, _cfg), minAbs);
      const nowEl = document.createElement('div');
      nowEl.className = 'tl-now';
      nowEl.style.top = nowY + 'px';
      nowEl.innerHTML = '<span class="tl-now-label">NOW</span>';
      inner.appendChild(nowEl);
    }

    const sorted = [..._events].sort((a, b) =>
      TimeCalc.toAbsolute({ year: a.year, month: a.month, week: a.week, day: a.day, hour: a.hour || 0 }, _cfg) -
      TimeCalc.toAbsolute({ year: b.year, month: b.month, week: b.week, day: b.day, hour: b.hour || 0 }, _cfg)
    );

    sorted.forEach((ev, i) => {
      const abs = TimeCalc.toAbsolute({ year: ev.year, month: ev.month, week: ev.week, day: ev.day, hour: ev.hour || 0 }, _cfg);
      const y = _absToY(abs, minAbs);
      const side = i % 2 === 0 ? 'left' : 'right';
      const color = ev.color || _cfg.defaultEventColor || '#6B3A2A';

      const wrap = document.createElement('div');
      wrap.className = `tl-event tl-event-${side}`;
      wrap.style.top = y + 'px';

      if (ev.endYear != null) {
        const endAbs = TimeCalc.toAbsolute({ year: ev.endYear, month: ev.endMonth, week: ev.endWeek, day: ev.endDay, hour: ev.endHour || 0 }, _cfg);
        const barH = Math.max(3, (endAbs - abs) * _pph);
        const bar = document.createElement('div');
        bar.className = 'tl-bar';
        bar.style.cssText = `height:${barH}px;background:${color}`;
        wrap.appendChild(bar);
      }

      const dot = document.createElement('div');
      dot.className = 'tl-dot';
      dot.style.background = color;
      wrap.appendChild(dot);

      const chip = document.createElement('div');
      chip.className = 'tl-chip';
      chip.style.setProperty('--chip-color', color);
      chip.innerHTML = `<div class="tl-chip-title">${_esc(ev.title)}</div><div class="tl-chip-date">${_esc(TimeCalc.formatShort(ev, _cfg))}</div>`;
      chip.addEventListener('click', e => { e.stopPropagation(); if (_onEventClick) _onEventClick(ev.id, chip); });
      wrap.appendChild(chip);

      inner.appendChild(wrap);
    });

    inner.addEventListener('click', e => {
      if (!_addArmed) return;
      if (e.target.closest('.tl-event') || e.target.closest('.tl-now')) return;
      _addArmed = false;
      _container.classList.remove('tl-add-armed');
      const rect = inner.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const abs = Math.max(0, _yToAbs(y, minAbs));
      if (_onDateClick) _onDateClick(TimeCalc.fromAbsolute(abs, _cfg));
    });
  }

  function scrollToNow() {
    if (!_container || !_cfg || !_currentDate) return;
    const { min: minAbs } = _minMaxAbs();
    const nowY = _absToY(TimeCalc.toAbsolute(_currentDate, _cfg), minAbs);
    _container.scrollTop = Math.max(0, nowY - _container.clientHeight * 0.75);
  }

  function zoom(factor) {
    _pph = Math.max(MIN_PPH, Math.min(MAX_PPH, _pph * factor));
    render();
    if (_container && _currentDate) {
      const { min: newMin } = _minMaxAbs();
      const newNowY = _absToY(TimeCalc.toAbsolute(_currentDate, _cfg), newMin);
      _container.scrollTop = Math.max(0, newNowY - _container.clientHeight * 0.75);
    }
  }

  function armAddMode() {
    _addArmed = true;
    if (_container) _container.classList.add('tl-add-armed');
  }

  function disarmAddMode() {
    _addArmed = false;
    if (_container) _container.classList.remove('tl-add-armed');
  }

  return { init, setData, render, scrollToNow, zoom, armAddMode, disarmAddMode };
})();
