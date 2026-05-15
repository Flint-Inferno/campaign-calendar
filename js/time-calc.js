const TimeCalc = (() => {
  function toAbsolute(date, cfg) {
    const { daysPerWeek, weeksPerMonth, monthsPerYear, hoursPerDay } = cfg;
    return (
      (date.year - 1) * monthsPerYear * weeksPerMonth * daysPerWeek * hoursPerDay +
      (date.month - 1) * weeksPerMonth * daysPerWeek * hoursPerDay +
      (date.week - 1) * daysPerWeek * hoursPerDay +
      (date.day - 1) * hoursPerDay +
      (date.hour || 0)
    );
  }

  function fromAbsolute(totalHours, cfg) {
    const { daysPerWeek, weeksPerMonth, monthsPerYear, hoursPerDay } = cfg;
    totalHours = Math.max(0, Math.floor(totalHours));
    const hour = totalHours % hoursPerDay;
    let rem = Math.floor(totalHours / hoursPerDay);
    const day = rem % daysPerWeek + 1;
    rem = Math.floor(rem / daysPerWeek);
    const week = rem % weeksPerMonth + 1;
    rem = Math.floor(rem / weeksPerMonth);
    const month = rem % monthsPerYear + 1;
    const year = Math.floor(rem / monthsPerYear) + 1;
    return { year, month, week, day, hour };
  }

  function add(date, duration, cfg) {
    const { daysPerWeek, weeksPerMonth, monthsPerYear, hoursPerDay } = cfg;
    const dpm = daysPerWeek * weeksPerMonth;
    const dpy = dpm * monthsPerYear;
    const delta =
      (duration.years || 0) * dpy * hoursPerDay +
      (duration.months || 0) * dpm * hoursPerDay +
      (duration.weeks || 0) * daysPerWeek * hoursPerDay +
      (duration.days || 0) * hoursPerDay +
      (duration.hours || 0);
    return fromAbsolute(toAbsolute(date, cfg) + delta, cfg);
  }

  function compare(a, b, cfg) {
    const diff = toAbsolute(a, cfg) - toAbsolute(b, cfg);
    return diff < 0 ? -1 : diff > 0 ? 1 : 0;
  }

  function isSameDay(a, b) {
    return a.year === b.year && a.month === b.month && a.week === b.week && a.day === b.day;
  }

  function format(date, cfg) {
    const mn = (cfg.monthNames || [])[date.month - 1] || `Month ${date.month}`;
    const wn = (cfg.weekNames || [])[date.week - 1] || `Week ${date.week}`;
    const dn = (cfg.dayNames || [])[date.day - 1] || `Day ${date.day}`;
    const h = String(date.hour || 0).padStart(2, '0');
    return `Year ${date.year} · ${mn} · ${wn} · ${dn} · ${h}:00`;
  }

  function formatShort(date, cfg) {
    const mn = (cfg.monthNames || [])[date.month - 1] || `M${date.month}`;
    const wn = (cfg.weekNames || [])[date.week - 1] || `W${date.week}`;
    const h = String(date.hour || 0).padStart(2, '0');
    return `Y${date.year} ${mn}, ${wn} D${date.day} ${h}:00`;
  }

  return { toAbsolute, fromAbsolute, add, compare, isSameDay, format, formatShort };
})();
