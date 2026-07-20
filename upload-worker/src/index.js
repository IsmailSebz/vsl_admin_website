// ══════════════════════════════════════
//  VSL MEDIA UPLOAD WORKER
//
//  Handles everything the admin panel needs that a static site can't do
//  on its own, using credentials that never touch the browser:
//
//    POST   /upload      — store a file in R2, return its public URL
//    DELETE /upload       — remove a previously-uploaded file from R2
//    POST   /send-email   — relay an inquiry reply through Resend
//
//  Every request must carry a valid, logged-in Supabase session token
//  (the same one the admin panel already holds) — verified against the
//  Supabase project on every call. The admin browser never gets R2
//  credentials or the Resend API key; only this Worker holds them.
// ══════════════════════════════════════

// Restrict this to your real admin origin once it's live,
// e.g. 'https://admin.victoriasugar.ug'. '*' works everywhere in the meantime.
const ALLOWED_ORIGIN = '*';

// Public domain your R2 bucket is already served from (read side).
const PUBLIC_BASE_URL = 'https://media.victoriasugar.ug';

// Folders admins are allowed to upload into. Anything else is rejected.
const ALLOWED_FOLDERS = new Set(['images', 'videos', 'docs']);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (url.pathname === '/upload' && request.method === 'POST') return withCors(await handleUpload(request, env));
    if (url.pathname === '/upload' && request.method === 'DELETE') return withCors(await handleDelete(request, env));
    if (url.pathname === '/send-email' && request.method === 'POST') return withCors(await handleSendEmail(request, env));

    return withCors(jsonError('Not found', 404));
  },
};

// ── Shared: verify the caller is a logged-in admin ─────────────────

async function requireSession(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const userRes = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + token, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) return null;
  return userRes.json();
}

// ── POST /upload ─────────────────────────────────────────────────

async function handleUpload(request, env) {
  const user = await requireSession(request, env);
  if (!user) return jsonError('Invalid or expired session — please log in again.', 401);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return jsonError('Expected multipart/form-data with a "file" field', 400);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return jsonError('No file provided', 400);

  let folder = (form.get('folder') || 'images').toString().toLowerCase();
  if (!ALLOWED_FOLDERS.has(folder)) folder = 'images';

  const MAX_BYTES = 25 * 1024 * 1024; // 25MB
  if (file.size > MAX_BYTES) return jsonError('File is too large (25MB max)', 413);

  const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const key = folder + '/' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '-' + safeName;

  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const publicUrl = PUBLIC_BASE_URL + '/' + key;
  return new Response(JSON.stringify({ url: publicUrl, key: key }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── DELETE /upload ───────────────────────────────────────────────
//
// Body: { "url": "https://media.victoriasugar.ug/images/....jpg" }
// (or { "key": "images/....jpg" } directly)

async function handleDelete(request, env) {
  const user = await requireSession(request, env);
  if (!user) return jsonError('Invalid or expired session — please log in again.', 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError('Expected JSON body with a "url" or "key" field', 400);
  }

  const key = body.key || urlToKey(body.url);
  if (!key) return jsonError('Could not determine which file to delete', 400);

  await env.MEDIA_BUCKET.delete(key);
  return new Response(JSON.stringify({ deleted: key }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function urlToKey(url) {
  if (!url) return null;
  if (url.startsWith(PUBLIC_BASE_URL + '/')) return url.slice((PUBLIC_BASE_URL + '/').length);
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '');
  } catch (e) {
    return null;
  }
}

// ── POST /send-email ─────────────────────────────────────────────
//
// Body: { "to": "person@example.com", "subject": "...", "message": "..." }
// Relays through Resend (https://resend.com). Requires the RESEND_API_KEY
// secret to be set (`wrangler secret put RESEND_API_KEY`) — until then
// this returns a clear error and the admin panel falls back to opening
// the admin's own email client instead.

async function handleSendEmail(request, env) {
  const user = await requireSession(request, env);
  if (!user) return jsonError('Invalid or expired session — please log in again.', 401);

  if (!env.RESEND_API_KEY || env.RESEND_API_KEY.includes('placeholder')) {
    return jsonError('Email sending is not configured yet (missing RESEND_API_KEY secret).', 501);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError('Expected JSON body with "to", "subject", and "message"', 400);
  }

  const { to, subject, message } = body;
  if (!to || !subject || !message) return jsonError('"to", "subject", and "message" are required', 400);

  const fromAddress = env.CONTACT_EMAIL ? `Victoria Sugar Limited <${env.CONTACT_EMAIL}>` : 'Victoria Sugar Limited <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress,
      to: [to],
      reply_to: env.CONTACT_EMAIL || undefined,
      subject,
      text: message,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return jsonError(errBody.message || 'Resend rejected the email', 502);
  }

  return new Response(JSON.stringify({ sent: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(res) {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return new Response(res.body, { status: res.status, headers: headers });
}
