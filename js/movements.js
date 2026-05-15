const Movements = (() => {
  let _data = [];

  async function load() {
    try {
      const { content } = await GithubAPI.readFile('data/movements.json');
      _data = Array.isArray(content) ? content : [];
    } catch (_) { _data = []; }
  }

  async function save(msg) {
    await GithubAPI.writeJSON('data/movements.json', _data, msg || 'Update movements');
  }

  function getForDay(year, month, week, day) {
    return _data.find(m =>
      m.year === year && m.month === month && m.week === week && m.day === day
    ) || null;
  }

  function getForMonth(year, month) {
    return _data.filter(m => m.year === year && m.month === month);
  }

  function getForWeek(year, month, week) {
    return _data.filter(m => m.year === year && m.month === month && m.week === week);
  }

  function getStartLocation(date, cfg) {
    const absDay = TimeCalc.toAbsolute({ ...date, hour: 0 }, cfg);
    const prev = _data
      .filter(m => m.endLocation &&
        TimeCalc.toAbsolute({ year: m.year, month: m.month, week: m.week, day: m.day, hour: 0 }, cfg) < absDay)
      .sort((a, b) =>
        TimeCalc.toAbsolute({ year: b.year, month: b.month, week: b.week, day: b.day, hour: 0 }, cfg) -
        TimeCalc.toAbsolute({ year: a.year, month: a.month, week: a.week, day: a.day, hour: 0 }, cfg)
      );
    return prev[0]?.endLocation || null;
  }

  async function setDay(year, month, week, day, updates) {
    const idx = _data.findIndex(m =>
      m.year === year && m.month === month && m.week === week && m.day === day
    );
    if (idx >= 0) {
      _data[idx] = { ..._data[idx], ...updates };
    } else {
      _data.push({ id: crypto.randomUUID(), year, month, week, day, ...updates });
    }
    await save(`Update movements: Y${year} M${month} W${week} D${day}`);
  }

  async function clearDay(year, month, week, day) {
    _data = _data.filter(m =>
      !(m.year === year && m.month === month && m.week === week && m.day === day)
    );
    await save(`Clear movements: Y${year} M${month} W${week} D${day}`);
  }

  function importJSON(arr) { _data = Array.isArray(arr) ? arr : []; }
  function getAll() { return _data; }

  return { load, save, getForDay, getForMonth, getForWeek, getStartLocation, setDay, clearDay, importJSON, getAll };
})();
