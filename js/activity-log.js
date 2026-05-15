const ActivityLog = (() => {
  let _data = [];

  async function load() {
    try {
      const { content } = await GithubAPI.readFile('data/activity-log.json');
      _data = Array.isArray(content) ? content : [];
    } catch (_) { _data = []; }
  }

  async function save() {
    await GithubAPI.writeJSON('data/activity-log.json', _data, 'Update activity log');
  }

  function getAll() { return [..._data].reverse(); }
  function importJSON(arr) { _data = Array.isArray(arr) ? arr : []; }
  function append(entry) { _data = [..._data, entry].slice(-500); }

  return { load, save, getAll, importJSON, append };
})();
