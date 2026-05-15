const GithubAPI = (() => {
  const BASE = 'https://api.github.com';

  function getPAT() {
    return localStorage.getItem('campaign_pat') || '';
  }

  function setPAT(pat) {
    localStorage.setItem('campaign_pat', pat.trim());
  }

  function authHeaders() {
    const pat = getPAT();
    const h = { 'Accept': 'application/vnd.github.v3+json' };
    if (pat) h['Authorization'] = `token ${pat}`;
    return h;
  }

  async function readFile(path) {
    const url = `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      if (res.status === 404) throw Object.assign(new Error(`Not found: ${path}`), { status: 404 });
      throw new Error(`GitHub read failed (${res.status}): ${path}`);
    }
    const data = await res.json();
    const text = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return { content: JSON.parse(text), sha: data.sha };
  }

  async function writeJSON(path, content, message) {
    let sha;
    try {
      const existing = await readFile(path);
      sha = existing.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    const pat = getPAT();
    if (!pat) throw new Error('No PAT set — enter your GitHub PAT to save changes.');

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
    const body = { message, content: encoded };
    if (sha) body.sha = sha;

    const res = await fetch(`${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub write failed (${res.status})`);
    }
    return res.json();
  }

  async function writeImage(path, base64Data, message) {
    let sha;
    try {
      const url = `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        sha = data.sha;
      }
    } catch (_) {}

    const pat = getPAT();
    if (!pat) throw new Error('No PAT set.');

    const body = { message, content: base64Data };
    if (sha) body.sha = sha;

    const res = await fetch(`${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Image upload failed (${res.status})`);
    }
    return res.json();
  }

  async function testPAT(pat) {
    const res = await fetch(`${BASE}/user`, {
      headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error('Invalid PAT or insufficient permissions.');
    return (await res.json()).login;
  }

  return { getPAT, setPAT, readFile, writeJSON, writeImage, testPAT };
})();
