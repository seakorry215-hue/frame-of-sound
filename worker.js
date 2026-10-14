/* Frame of Sound — Worker: static assets + photo API (R2 FILES + D1 DB) */
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8',
                       'access-control-allow-origin': '*' };

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS'){
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' } });
    }

    /* ── POST /api/upload (multipart: file, name, band, genre [, id]) ──
       รองรับ id จาก client เพื่อ "ฝากรูปเก่า" ขึ้นคลาวด์ได้ด้วย id เดิม (QR เก่าใช้ได้) */
    if (path === '/api/upload' && request.method === 'POST'){
      try {
        const form = await request.formData();
        const file = form.get('file');
        if (!file || typeof file === 'string') return j({ error: 'missing file' }, 400);
        if (file.size > 8 * 1024 * 1024) return j({ error: 'file too large (max 8MB)' }, 413);
        const ct = file.type || 'image/jpeg';
        if (!/^image\/(jpeg|png|webp)$/.test(ct)) return j({ error: 'only jpeg/png/webp' }, 415);

        let idIn = (form.get('id') || '').toString();
        let id = /^shot-[a-z0-9]{8,20}$/.test(idIn)
          ? idIn
          : 'shot-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const name  = (form.get('name')  || '').toString().slice(0, 40);
        const band  = (form.get('band')  || '').toString().slice(0, 60);
        const genre = (form.get('genre') || '').toString().slice(0, 20);

        const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
        await env.FILES.put(id + '.' + ext, file, { httpMetadata: { contentType: ct } });
        await env.DB.prepare(
          'INSERT OR REPLACE INTO photos (id, name, band, genre, created_at, file_key, mime) VALUES (?1,?2,?3,?4,?5,?6,?7)'
        ).bind(id, name, band, genre, Date.now(), id + '.' + ext, ct).run();

        return j({ id, url: '/files/' + id + '.' + ext });
      } catch (e){
        return j({ error: String(e && e.message || e) }, 500);
      }
    }

    /* ── GET /api/photo?id=… ── */
    if (path === '/api/photo' && request.method === 'GET'){
      const id = (url.searchParams.get('id') || '').slice(0, 40);
      if (!id) return j({ error: 'missing id' }, 400);
      const row = await env.DB.prepare(
        'SELECT id, name, band, genre, created_at, file_key FROM photos WHERE id = ?1'
      ).bind(id).first();
      if (!row) return j({ error: 'not found' }, 404);
      return j({ ...row, url: '/files/' + row.file_key });
    }

    /* ── GET /api/wall?genre=…&limit=… ── */
    if (path === '/api/wall' && request.method === 'GET'){
      const genre = (url.searchParams.get('genre') || 'all').slice(0, 20);
      const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
      const rs = genre === 'all'
        ? await env.DB.prepare('SELECT id, name, band, genre, created_at, file_key FROM photos ORDER BY created_at DESC LIMIT ?1').bind(limit).all()
        : await env.DB.prepare('SELECT id, name, band, genre, created_at, file_key FROM photos WHERE genre = ?1 ORDER BY created_at DESC LIMIT ?2').bind(genre, limit).all();
      return j({ items: (rs.results || []).map(r => ({ ...r, url: '/files/' + r.file_key })) });
    }

    /* ── POST /api/media/<key> — อัปโหลดสื่อแอป (ต้องมี x-media-token) ── */
    if (path.startsWith('/api/media/') && request.method === 'POST'){
      if (request.headers.get('x-media-token') !== env.MEDIA_TOKEN) return j({ error: 'unauthorized' }, 401);
      const key = safeDecode(path.slice('/api/media/'.length));
      await env.FILES.put('media/' + key, request.body, { httpMetadata: { contentType: guessType(key) } });
      return j({ ok: true, url: '/media/' + key });
    }

    /* ── GET /media/<key> (เพลง/รูปวง) ── */
    if (path.startsWith('/media/') && request.method === 'GET'){
      const key = safeDecode(path.slice('/media/'.length));
      const obj = await env.FILES.get('media/' + key);
      if (!obj) return new Response('not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('accept-ranges', 'bytes');
      return new Response(obj.body, { headers });
    }

    /* ── GET /files/<key> (รูปที่ผู้ใช้อัปโหลด) ── */
    if (path.startsWith('/files/') && request.method === 'GET'){
      const key = path.slice('/files/'.length).replace(/\.\./g, '');
      const obj = await env.FILES.get(key);
      if (!obj) return new Response('not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      return new Response(obj.body, { headers });
    }

    /* ── สร้างตารางครั้งแรก (idempotent) ── */
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY, name TEXT, band TEXT, genre TEXT,
        created_at INTEGER, file_key TEXT, mime TEXT)`).run();
    } catch (e){ /* มีตารางแล้ว — ข้าม */ }

    /* ── ที่เหลือ: static assets ──
       html ห้ามแคชเด็ดขาด กันมือถือค้างหน้าเวอร์ชันเก่า (สร้าง QR แบบ local) */
    const assetResp = await env.ASSETS.fetch(request);
    if (/(^|\/)index\.html?$/.test(path) || path === '/' || /(^|\/)download\.html?$/.test(path)){
      const h = new Headers(assetResp.headers);
      h.set('cache-control', 'no-cache, no-store, must-revalidate');
      return new Response(assetResp.body, { status: assetResp.status, headers: h });
    }
    return assetResp;
  }
};

function guessType(key){
  if (key.endsWith('.mp3'))  return 'audio/mpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.png'))  return 'image/png';
  return 'image/jpeg';
}

function safeDecode(s){
  try { return decodeURIComponent(s).replace(/\.\./g, ''); }
  catch (e){ return s.replace(/\.\./g, ''); }
}

function j(obj, status){ return new Response(JSON.stringify(obj), { status: status || 200, headers: JSON_HEADERS }); }
