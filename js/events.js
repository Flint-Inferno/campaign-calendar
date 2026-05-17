const Events = (() => {
  let _data = [];

  async function load() {
    try {
      const { content } = await GithubAPI.readFile('data/events.json');
      _data = Array.isArray(content) ? content : [];
    } catch (_) {
      _data = [];
    }
  }

  async function save(message, mergeFn) {
    await GithubAPI.writeJSON('data/events.json', _data, message, mergeFn);
  }

  async function add(event) {
    event.id = crypto.randomUUID();
    _data.push(event);
    const ev = event;
    await save(`Add event: ${ev.title}`,
      (remote) => remote.some(e => e.id === ev.id) ? remote : [...remote, ev]
    );
    return event;
  }

  async function update(id, updates) {
    const idx = _data.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Event not found');
    _data[idx] = { ..._data[idx], ...updates };
    const updated = _data[idx];
    await save(`Update event: ${updated.title}`,
      (remote) => remote.map(e => e.id === id ? updated : e)
    );
    return updated;
  }

  async function remove(id) {
    const ev = _data.find(e => e.id === id);
    _data = _data.filter(e => e.id !== id);
    await save(`Delete event: ${ev?.title ?? id}`,
      (remote) => remote.filter(e => e.id !== id)
    );
  }

  function getAll() {
    return _data;
  }

  function getForDay(year, month, week, day, cfg) {
    const dayStart = TimeCalc.toAbsolute({ year, month, week, day, hour: 0 }, cfg);
    const dayEnd = dayStart + cfg.hoursPerDay - 1;
    return _data.filter(ev => {
      const evStart = TimeCalc.toAbsolute(ev, cfg);
      const evEnd = ev.endYear != null
        ? TimeCalc.toAbsolute({ year: ev.endYear, month: ev.endMonth, week: ev.endWeek, day: ev.endDay, hour: ev.endHour || 0 }, cfg)
        : evStart + 1;
      return evStart <= dayEnd && evEnd >= dayStart;
    });
  }

  function getForWeek(year, month, week, cfg) {
    const weekStart = TimeCalc.toAbsolute({ year, month, week, day: 1, hour: 0 }, cfg);
    const weekEnd = weekStart + cfg.daysPerWeek * cfg.hoursPerDay - 1;
    return _data.filter(ev => {
      const evStart = TimeCalc.toAbsolute(ev, cfg);
      const evEnd = ev.endYear != null
        ? TimeCalc.toAbsolute({ year: ev.endYear, month: ev.endMonth, week: ev.endWeek, day: ev.endDay, hour: ev.endHour || 0 }, cfg)
        : evStart + 1;
      return evStart <= weekEnd && evEnd >= weekStart;
    });
  }

  function exportCSV() {
    const cols = ['id', 'title', 'description', 'year', 'month', 'week', 'day', 'hour',
      'endYear', 'endMonth', 'endWeek', 'endDay', 'endHour', 'color', 'mapX', 'mapY', 'tags', 'author'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(',')];
    for (const ev of _data) {
      rows.push(cols.map(c => escape(c === 'tags' ? (ev.tags || []).join(';') : ev[c])).join(','));
    }
    return rows.join('\n');
  }

  function importJSON(jsonArray) {
    if (!Array.isArray(jsonArray)) throw new Error('Expected a JSON array');
    _data = jsonArray;
  }

  return { load, save, add, update, remove, getAll, getForDay, getForWeek, exportCSV, importJSON };
})();
