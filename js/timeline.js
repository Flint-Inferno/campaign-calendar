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
  const GAP_THRESHOLD_DAYS = 30;
  const GAP_BAR_H = 52;

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

  function _buildLayout(minAbs, maxAbs) {
    const anchors = new Set([minAbs, maxAbs]);
    for (const ev of _events) {
      const a = TimeCalc.toAbsolute(
        { year: ev.year, month: ev.month, week: ev.week, day: ev.day, hour: ev.hour || 0 }, _cfg
      );
      if (a >= minAbs && a <= maxAbs) anchors.add(a);
      if (ev.endYear != null) {
        const b = TimeCalc.toAbsolute(
          { year: ev.endYear, month: ev.endMonth, week: ev.endWeek, day: ev.endDay, hour: ev.endHour || 0 }, _cfg
        );
        if (b >= minAbs && b <= maxAbs) anchors.add(b);
      }
    }
    const sorted = [...anchors].sort((a, b) => a - b);

    const threshold = GAP_THRESHOLD_DAYS * _cfg.hoursPerDay;
    const segments = [];
    let y = PAD;

    for (let i = 0; i < sorted.length - 1; i++) {
      const aStart = sorted[i];
      const aEnd   = sorted[i + 1];
      const span   = aEnd - aStart;
      if (span > threshold) {
        segments.push({ type: 'gap',  aStart, aEnd, yStart: y, yEnd: y + GAP_BAR_H });
        y += GAP_BAR_H;
      } else {
        const h = span * _pph;
        segments.push({ type: 'prop', aStart, aEnd, yStart: y, yEnd: y + h });
        y += h;
      }
    }

    const totalHeight = Math.max(200, y + PAD);

    function absToY(abs) {
      for (const s of segments) {
        if (abs <= s.aEnd) {
          if (s.type === 'gap') return s.yStart + GAP_BAR_H / 2;
          const frac = (abs - s.aStart) / (s.aEnd - s.aStart || 1);
          return s.yStart + frac * (s.yEnd - s.yStart);
        }
      }
      return segments.at(-1)?.yEnd ?? PAD;
    }

    function yToAbs(yCoord) {
      for (const s of segments) {
        if (yCoord <= s.yEnd) {
          if (s.type === 'gap') return Math.round((s.aStart + s.aEnd) / 2);
          const frac = (yCoord - s.yStart) / (s.yEnd - s.yStart || 1);
          return Math.round(s.aStart + frac * (s.aEnd - s.aStart));
        }
      }
      return segments.at(-1)?.aEnd ?? 0;
    }

    return { segments, totalHeight, absToY, yToAbs };
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _renderDividers(inner, layout) {
    const hpm = _cfg.weeksPerMonth * _cfg.daysPerWeek * _cfg.hoursPerDay;
    const hpy = hpm * _cfg.monthsPerYear;

    for (const seg of layout.segments) {
      if (seg.type === 'gap') {
        const diff   = seg.aEnd - seg.aStart;
        const years  = Math.floor(diff / hpy);
        const months = Math.floor((diff % hpy) / hpm);
        const label  = years > 0
          ? `${years}y ${months}m gap`
          : `${Math.round(diff / _cfg.hoursPerDay)}d gap`;

        const el = document.createElement('div');
        el.className = 'tl-gap-bar';
        el.style.top    = seg.yStart + 'px';
        el.style.height = GAP_BAR_H + 'px';
        el.textContent  = label;
        inner.appendChild(el);
      } else {
        const spanHours  = seg.aEnd - seg.aStart;
        const totalMonths = spanHours / hpm;
        const step = totalMonths > 48 ? hpy : hpm;
        const first = Math.ceil(seg.aStart / step) * step;
        for (let abs = first; abs < seg.aEnd; abs += step) {
          const date   = TimeCalc.fromAbsolute(abs, _cfg);
          const isYear = abs % hpy === 0;
          const div = document.createElement('div');
          div.className = 'tl-month-div' + (isYear ? ' is-year' : '');
          div.style.top = layout.absToY(abs) + 'px';
          const lbl = document.createElement('span');
          lbl.className = 'tl-month-div-label';
          const mn = (_cfg.monthNames || [])[date.month - 1] || `Month ${date.month}`;
          lbl.textContent = isYear ? `Year ${date.year}` : mn;
          div.appendChild(lbl);
          inner.appendChild(div);
        }
      }
    }
  }

  function render() {
    if (!_container || !_cfg) return;

    if (!_zoomInitialized && _container.clientHeight > 0) {
      _pph = _container.clientHeight / (INIT_DAYS_SPAN * _cfg.hoursPerDay);
      _zoomInitialized = true;
    }

    const { min: minAbs, max: maxAbs } = _minMaxAbs();
    const layout = _buildLayout(minAbs, maxAbs);

    _container.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'tl-inner';
    inner.style.height = layout.totalHeight + 'px';
    _container.appendChild(inner);

    const cl = document.createElement('div');
    cl.className = 'tl-center-line';
    inner.appendChild(cl);

    _renderDividers(inner, layout);

    if (_currentDate) {
      const nowY = layout.absToY(TimeCalc.toAbsolute(_currentDate, _cfg));
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
      const abs = TimeCalc.toAbsolute(
        { year: ev.year, month: ev.month, week: ev.week, day: ev.day, hour: ev.hour || 0 }, _cfg
      );
      const y    = layout.absToY(abs);
      const side = i % 2 === 0 ? 'left' : 'right';
      const color = ev.color || _cfg.defaultEventColor || '#6B3A2A';

      const wrap = document.createElement('div');
      wrap.className = `tl-event tl-event-${side}`;
      wrap.style.top = y + 'px';

      if (ev.endYear != null) {
        const endAbs = TimeCalc.toAbsolute(
          { year: ev.endYear, month: ev.endMonth, week: ev.endWeek, day: ev.endDay, hour: ev.endHour || 0 }, _cfg
        );
        const barH = Math.max(3, layout.absToY(endAbs) - y);
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
      if (e.target.closest('.tl-event') || e.target.closest('.tl-now') || e.target.closest('.tl-gap-bar')) return;
      _addArmed = false;
      _container.classList.remove('tl-add-armed');
      const rect = inner.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const abs = Math.max(0, layout.yToAbs(clickY));
      if (_onDateClick) _onDateClick(TimeCalc.fromAbsolute(abs, _cfg));
    });
  }

  function scrollToNow() {
    if (!_container || !_cfg || !_currentDate) return;
    const { min: minAbs, max: maxAbs } = _minMaxAbs();
    const layout = _buildLayout(minAbs, maxAbs);
    const nowY = layout.absToY(TimeCalc.toAbsolute(_currentDate, _cfg));
    _container.scrollTop = Math.max(0, nowY - _container.clientHeight * 0.75);
  }

  function zoom(factor) {
    _pph = Math.max(MIN_PPH, Math.min(MAX_PPH, _pph * factor));
    render();
    scrollToNow();
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
