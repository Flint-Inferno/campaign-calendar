const Calendar = (() => {
  let _cfg = null;
  let _container = null;
  let _view = 'month';
  let _nav = { year: 1, month: 1, week: 1 };
  let _currentDate = null;

  let onEventClick = null;
  let onCellClick = null;

  const HOUR_HEIGHT = 44;

  function init(container, cfg, currentDate) {
    _container = container;
    _cfg = cfg;
    _currentDate = currentDate;
    _nav = { year: currentDate.year, month: currentDate.month, week: currentDate.week };
  }

  function setConfig(cfg) { _cfg = cfg; }
  function setCurrentDate(d) { _currentDate = d; }
  function setView(v) { _view = v; }
  function getView() { return _view; }
  function getNav() { return { ..._nav }; }

  function navigatePrev() {
    if (_view === 'month') {
      _nav.month--;
      if (_nav.month < 1) { _nav.month = _cfg.monthsPerYear; _nav.year--; if (_nav.year < 1) _nav.year = 1; }
      _nav.week = 1;
    } else {
      _nav.week--;
      if (_nav.week < 1) {
        _nav.month--;
        if (_nav.month < 1) { _nav.month = _cfg.monthsPerYear; _nav.year--; if (_nav.year < 1) { _nav.year = 1; _nav.month = 1; } }
        _nav.week = _cfg.weeksPerMonth;
      }
    }
  }

  function navigateNext() {
    if (_view === 'month') {
      _nav.month++;
      if (_nav.month > _cfg.monthsPerYear) { _nav.month = 1; _nav.year++; }
      _nav.week = 1;
    } else {
      _nav.week++;
      if (_nav.week > _cfg.weeksPerMonth) {
        _nav.week = 1;
        _nav.month++;
        if (_nav.month > _cfg.monthsPerYear) { _nav.month = 1; _nav.year++; }
      }
    }
  }

  function goToDate(date) {
    _nav.year = date.year;
    _nav.month = date.month;
    _nav.week = date.week;
  }

  function navLabel() {
    const mn = (_cfg.monthNames || [])[_nav.month - 1] || `Month ${_nav.month}`;
    if (_view === 'month') return `Year ${_nav.year} · ${mn}`;
    const wn = (_cfg.weekNames || [])[_nav.week - 1] || `Week ${_nav.week}`;
    return `Year ${_nav.year} · ${mn} · ${wn}`;
  }

  function dayLabel(dayIdx) {
    const dn = (_cfg.dayNames || [])[dayIdx];
    return dn || `${dayIdx + 1}`;
  }

  function renderMonth() {
    const eventsForMonth = [];
    for (let w = 1; w <= _cfg.weeksPerMonth; w++) {
      for (let d = 1; d <= _cfg.daysPerWeek; d++) {
        eventsForMonth.push({ week: w, day: d, events: Events.getForDay(_nav.year, _nav.month, w, d, _cfg) });
      }
    }

    const html = [];
    html.push('<div class="month-view">');
    html.push('<div class="month-header-row">');
    html.push('<div class="week-label-header"></div>');
    for (let d = 0; d < _cfg.daysPerWeek; d++) {
      html.push(`<div class="day-header">${dayLabel(d)}</div>`);
    }
    html.push('</div>');

    for (let w = 1; w <= _cfg.weeksPerMonth; w++) {
      const wn = (_cfg.weekNames || [])[w - 1] || `Week ${w}`;
      html.push('<div class="week-row">');
      html.push(`<div class="week-label">${wn}</div>`);
      for (let d = 1; d <= _cfg.daysPerWeek; d++) {
        const isCurrent = _currentDate &&
          _currentDate.year === _nav.year && _currentDate.month === _nav.month &&
          _currentDate.week === w && _currentDate.day === d;
        const cellEvents = Events.getForDay(_nav.year, _nav.month, w, d, _cfg);
        const cls = ['day-cell', isCurrent ? 'current-day' : ''].filter(Boolean).join(' ');
        html.push(`<div class="${cls}" data-year="${_nav.year}" data-month="${_nav.month}" data-week="${w}" data-day="${d}">`);
        html.push(`<span class="day-number">${(w - 1) * _cfg.daysPerWeek + d}</span>`);
        html.push('<div class="cell-events">');
        for (const ev of cellEvents) {
          const color = ev.color || _cfg.defaultEventColor || '#6B3A2A';
          const bright = isColorLight(color);
          html.push(`<div class="event-chip" data-event-id="${ev.id}" style="background:${color};color:${bright ? '#2c1810' : '#f4e4c1'}" title="${escHtml(ev.title)}">${escHtml(ev.title)}</div>`);
        }
        html.push('</div></div>');
      }
      html.push('</div>');
    }
    html.push('</div>');
    _container.innerHTML = html.join('');
    attachMonthListeners();
  }

  function renderWeek() {
    const weekEvents = Events.getForWeek(_nav.year, _nav.month, _nav.week, _cfg);

    const html = [];
    html.push('<div class="week-view">');
    html.push('<div class="week-view-header">');
    html.push('<div class="wv-corner"></div>');
    for (let d = 1; d <= _cfg.daysPerWeek; d++) {
      const isCurrent = _currentDate &&
        _currentDate.year === _nav.year && _currentDate.month === _nav.month &&
        _currentDate.week === _nav.week && _currentDate.day === d;
      const cls = ['wv-day-header', isCurrent ? 'current-day-header' : ''].filter(Boolean).join(' ');
      const domLabel = (_cfg.dayNames || [])[d - 1] || String((_nav.week - 1) * _cfg.daysPerWeek + d);
      html.push(`<div class="${cls}" data-day="${d}">${domLabel}</div>`);
    }
    html.push('</div>');

    html.push('<div class="week-view-body">');
    html.push('<div class="hour-labels">');
    for (let h = 0; h < _cfg.hoursPerDay; h++) {
      html.push(`<div class="hour-label" style="height:${HOUR_HEIGHT}px">${String(h).padStart(2,'0')}:00</div>`);
    }
    html.push('</div>');

    html.push('<div class="day-columns">');
    for (let d = 1; d <= _cfg.daysPerWeek; d++) {
      html.push(`<div class="day-col" data-year="${_nav.year}" data-month="${_nav.month}" data-week="${_nav.week}" data-day="${d}">`);
      for (let h = 0; h < _cfg.hoursPerDay; h++) {
        const isCurrHour = _currentDate && _currentDate.year === _nav.year &&
          _currentDate.month === _nav.month && _currentDate.week === _nav.week &&
          _currentDate.day === d && _currentDate.hour === h;
        html.push(`<div class="hour-slot${isCurrHour ? ' current-hour' : ''}" data-hour="${h}" style="height:${HOUR_HEIGHT}px"></div>`);
      }
      const dayStart = TimeCalc.toAbsolute({ year: _nav.year, month: _nav.month, week: _nav.week, day: d, hour: 0 }, _cfg);
      const dayEnd = dayStart + _cfg.hoursPerDay;
      for (const ev of weekEvents) {
        const evStart = TimeCalc.toAbsolute(ev, _cfg);
        const evEnd = ev.endYear != null
          ? TimeCalc.toAbsolute({ year: ev.endYear, month: ev.endMonth, week: ev.endWeek, day: ev.endDay, hour: ev.endHour || 0 }, _cfg)
          : evStart + _cfg.hoursPerDay - 1;
        const blockStart = Math.max(evStart, dayStart);
        const blockEnd = Math.min(evEnd, dayEnd - 1);
        if (blockStart > blockEnd) continue;
        const startHour = blockStart - dayStart;
        const endHour = blockEnd - dayStart + 1;
        const top = startHour * HOUR_HEIGHT;
        const height = Math.max(HOUR_HEIGHT, (endHour - startHour) * HOUR_HEIGHT);
        const color = ev.color || _cfg.defaultEventColor || '#6B3A2A';
        const bright = isColorLight(color);
        html.push(`<div class="week-event-block" data-event-id="${ev.id}" style="top:${top}px;height:${height}px;background:${color};color:${bright ? '#2c1810' : '#f4e4c1'}">${escHtml(ev.title)}</div>`);
      }
      html.push('</div>');
    }
    html.push('</div>');
    html.push('</div>');
    html.push('</div>');
    _container.innerHTML = html.join('');
    attachWeekListeners();
  }

  function render() {
    if (_view === 'month') renderMonth();
    else renderWeek();
  }

  function attachMonthListeners() {
    _container.querySelectorAll('.event-chip').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (onEventClick) onEventClick(el.dataset.eventId);
      });
    });
    _container.querySelectorAll('.day-cell').forEach(el => {
      el.addEventListener('click', () => {
        if (onCellClick) onCellClick({
          year: +el.dataset.year, month: +el.dataset.month,
          week: +el.dataset.week, day: +el.dataset.day, hour: 0
        });
      });
    });
  }

  function attachWeekListeners() {
    _container.querySelectorAll('.week-event-block').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (onEventClick) onEventClick(el.dataset.eventId);
      });
    });
    _container.querySelectorAll('.hour-slot').forEach(el => {
      el.addEventListener('click', () => {
        const col = el.closest('.day-col');
        if (onCellClick) onCellClick({
          year: +col.dataset.year, month: +col.dataset.month,
          week: +col.dataset.week, day: +col.dataset.day,
          hour: +el.dataset.hour
        });
      });
    });
  }

  function isColorLight(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    init, setConfig, setCurrentDate, setView, getView, getNav,
    navigatePrev, navigateNext, goToDate, navLabel, render,
    set onEventClick(fn) { onEventClick = fn; },
    set onCellClick(fn) { onCellClick = fn; }
  };
})();
