// jesustime-friends — API: leaderboard (per group code) + sync
// KV binding: "KV" = jesustime-friends namespace
// Secret: set via `wrangler secret put APP_TOKEN`

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-app-token, x-esv-token",
};

function mergeEntries(local, remote) {
  const merged = Object.assign({}, local);
  Object.keys(remote || {}).forEach(day => {
    if (!merged[day]) { merged[day] = remote[day]; }
    else {
      const existTs = new Set(merged[day].map(e => e.ts));
      const newE = (remote[day] || []).filter(e => !existTs.has(e.ts));
      if (newE.length) merged[day] = merged[day].concat(newE);
    }
  });
  return merged;
}

// Personal names: UNION by name (case-insensitive) so a device with fewer
// (or zero) names can never wipe out another device's names.
function mergeNames(a, b) {
  const out = []; const idx = {};
  const norm = s => String(s || "").trim().toLowerCase();
  (Array.isArray(a) ? a : []).forEach(it => {
    if (!it || !norm(it.n)) return;
    const k = norm(it.n);
    if (idx[k] === undefined) { idx[k] = out.length; out.push({ n: it.n, a: it.a || "" }); }
  });
  (Array.isArray(b) ? b : []).forEach(it => {
    if (!it || !norm(it.n)) return;
    const k = norm(it.n);
    if (idx[k] === undefined) { idx[k] = out.length; out.push({ n: it.n, a: it.a || "" }); }
    else if (!out[idx[k]].a && it.a) out[idx[k]].a = it.a;
  });
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight — no auth needed
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    // ── Secret token check ────────────────────────────────────
    if (env.APP_TOKEN) {
      const token = request.headers.get("x-app-token");
      if (token !== env.APP_TOKEN) {
        await new Promise(r => setTimeout(r, 2000));
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    // ── GET /esv?q=John+15:5 — ESV API proxy (browser CORS workaround) ──
    // Secret: set via `npx wrangler secret put ESV_TOKEN`
    if (request.method === "GET" && url.pathname === "/esv") {
      const q = url.searchParams.get("q") || "";
      if (!q) return new Response(JSON.stringify({ error: "Missing q" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
      const rawKey = env.ESV_TOKEN || request.headers.get("x-esv-token") || "";
      // Accept sloppy pastes: full header lines ("Authorization: Token abc..."), quotes, prefixes.
      // An ESV key is a long hex string — extract it if present, else strip known prefixes.
      const hexMatch = rawKey.match(/[0-9a-fA-F]{32,64}/);
      const esvKey = hexMatch ? hexMatch[0]
        : rawKey.trim().replace(/^["']|["']$/g, "").replace(/^Authorization:?\s*/i, "").replace(/^Token\s+/i, "").trim();
      if (!esvKey) return new Response(JSON.stringify({ error: "No ESV token — set worker secret ESV_TOKEN, or paste your token in the app" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
      // Honor the app's include-* flags (default to the old behavior when absent).
      const sp = url.searchParams;
      const flag = (name, def) => { const v = sp.get(name); return v === null ? def : (v === "true" || v === "1"); };
      const esvUrl = "https://api.esv.org/v3/passage/text/?q=" + encodeURIComponent(q)
        + "&include-passage-references=" + flag("include-passage-references", false)
        + "&include-verse-numbers=" + flag("include-verse-numbers", false)
        + "&include-footnotes=" + flag("include-footnotes", false)
        + "&include-headings=" + flag("include-headings", false)
        + "&include-short-copyright=false";
      const keySource = env.ESV_TOKEN ? "worker secret ESV_TOKEN" : "token pasted in app";
      const r = await fetch(esvUrl, { headers: { Authorization: `Token ${esvKey}` } });
      const body = await r.text();
      if (!r.ok) {
        let detail = "";
        try { detail = JSON.parse(body).detail || ""; } catch (e) {}
        return new Response(JSON.stringify({
          error: `${detail || `ESV rejected the request (${r.status})`} — key source: ${keySource}, ${esvKey.length} chars`,
        }), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
      }
      return new Response(body, {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── GET /ping — token verification ───────────────────────
    if (request.method === "GET" && url.pathname === "/ping") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── GET /board/:code ──────────────────────────────────────
    if (request.method === "GET" && url.pathname.startsWith("/board/")) {
      const code = decodeURIComponent(url.pathname.slice("/board/".length)).trim();
      if (!code) return new Response(JSON.stringify({ board: {} }), { headers: { ...CORS, "Content-Type": "application/json" } });
      const list = await env.KV.list({ prefix: `scores:${code}:` });
      const board = {};
      await Promise.all(list.keys.map(async ({ name }) => {
        const tag = name.slice(`scores:${code}:`.length);
        const val = await env.KV.get(name);
        if (val) board[tag] = JSON.parse(val);
      }));
      // Cheer counts: keys cheers:{code}:{tag}:{ini} → int
      const cheerList = await env.KV.list({ prefix: `cheers:${code}:` });
      const cheers = {};
      await Promise.all(cheerList.keys.map(async ({ name }) => {
        const key = name.slice(`cheers:${code}:`.length); // "{tag}:{ini}"
        const val = await env.KV.get(name);
        if (val) cheers[key] = parseInt(val) || 0;
      }));
      return new Response(JSON.stringify({ board, cheers }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── POST /score ───────────────────────────────────────────
    if (request.method === "POST" && url.pathname === "/score") {
      let body;
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS });
      }
      const { ini, tag, streak, date, code, lastNote } = body;
      if (!ini || !tag || streak == null || !code)
        return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: CORS });
      // Validate
      if (!/^[A-Z]{1,3}$/i.test(ini) || streak > 3650 || streak < 0)
        return new Response(JSON.stringify({ error: "Invalid data" }), { status: 400, headers: CORS });
      const key = `scores:${code}:${tag}`;
      const existing = JSON.parse(await env.KV.get(key) || "[]");
      // streak=0 means remove this user's entry
      const updated = existing.filter(e => e.ini !== ini.toUpperCase().slice(0, 3));
      if (Number(streak) > 0) {
        const entry = {
          ini: ini.toUpperCase().slice(0, 3),
          streak: Number(streak),
          date: date || "",
        };
        if (lastNote && typeof lastNote === "string") {
          entry.lastNote = lastNote.trim().slice(0, 70);
        }
        updated.push(entry);
        updated.sort((a, b) => b.streak - a.streak);
      }
      await env.KV.put(key, JSON.stringify(updated.slice(0, 10)));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── POST /cheer — 🙌 a friend's streak ────────────────────
    if (request.method === "POST" && url.pathname === "/cheer") {
      let body;
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS });
      }
      const { code, tag, ini } = body;
      if (!code || !tag || !ini || !/^[A-Z]{1,3}$/i.test(ini) || String(tag).length > 60)
        return new Response(JSON.stringify({ error: "Invalid data" }), { status: 400, headers: CORS });
      const key = `cheers:${code}:${tag}:${ini.toUpperCase().slice(0, 3)}`;
      const count = (parseInt(await env.KV.get(key)) || 0) + 1;
      await env.KV.put(key, String(count));
      return new Response(JSON.stringify({ ok: true, count }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── GET /sync/:code ───────────────────────────────────────
    if (request.method === "GET" && url.pathname.startsWith("/sync/")) {
      const code = decodeURIComponent(url.pathname.slice("/sync/".length)).trim().toLowerCase();
      if (!code) return new Response(JSON.stringify({ exists: false }), { headers: { ...CORS, "Content-Type": "application/json" } });
      const val = await env.KV.get("sync:" + code);
      // Personal names (timestamped, last-write-wins)
      let names = null, namesTs = 0;
      try { const nv = await env.KV.get("pnames:" + code); if (nv) { const o = JSON.parse(nv); names = o.names || null; namesTs = o.ts || 0; } } catch (e) {}
      if (val === null && names === null)
        return new Response(JSON.stringify({ exists: false }), { headers: { ...CORS, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ exists: true, entries: val ? JSON.parse(val) : {}, names, namesTs }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── POST /sync/:code ──────────────────────────────────────
    if (request.method === "POST" && url.pathname.startsWith("/sync/")) {
      const code = decodeURIComponent(url.pathname.slice("/sync/".length)).trim().toLowerCase();
      if (!code) return new Response(JSON.stringify({ error: "No code" }), { status: 400, headers: CORS });
      let body;
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS });
      }
      const incoming = body.entries || {};
      const existing = JSON.parse(await env.KV.get("sync:" + code) || "{}");
      const merged = mergeEntries(existing, incoming);
      await env.KV.put("sync:" + code, JSON.stringify(merged));
      // Personal names: UNION stored + incoming (never lose a device's names)
      let names = null, namesTs = 0;
      try { const nv = await env.KV.get("pnames:" + code); if (nv) { const o = JSON.parse(nv); names = o.names || null; namesTs = o.ts || 0; } } catch (e) {}
      if (Array.isArray(body.names)) {
        const before = JSON.stringify(names || []);
        names = mergeNames(names || [], body.names);
        if (JSON.stringify(names) !== before) {
          namesTs = Date.now();
          await env.KV.put("pnames:" + code, JSON.stringify({ names, ts: namesTs }));
        }
      }
      return new Response(JSON.stringify({ ok: true, entries: merged, names, namesTs }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers: CORS });
  },
};