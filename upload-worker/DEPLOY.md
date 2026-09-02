# Deploying the upload Worker

This Worker is what the admin panel talks to for three things:

- `POST /upload` — store an uploaded file in the `vsl-media` R2 bucket
- `DELETE /upload` — remove a file from R2 when it's deleted in the admin panel
- `POST /send-email` — send an inquiry reply through Resend

I can't reach the Cloudflare API directly from this sandbox (it's outside
the allowlisted network), so you'll need to run the deploy command
yourself — it only takes a minute.

## 1. Install Wrangler (Cloudflare's CLI), if you don't have it

```
npm install -g wrangler
```

## 2. Authenticate with the API token from your .env

You already have a Cloudflare API token in `.env` (`Token value: cfat_...`).
Export it so Wrangler picks it up automatically — no browser login needed:

```
export CLOUDFLARE_API_TOKEN=cfat_...   # paste the token value from .env
```

(On Windows PowerShell: `$env:CLOUDFLARE_API_TOKEN="cfat_..."`)

## 3. Deploy

From inside this `upload-worker` folder:

```
wrangler deploy
```

This publishes the Worker and binds it to your `vsl-media` R2 bucket
(already configured in `wrangler.toml`).

## 4. Set the Resend secret (for inquiry email replies)

The `.env` file currently has a placeholder `RESEND_API_KEY`. Once you have
a real one from https://resend.com, set it as a Worker secret (never put
real secrets in `wrangler.toml`, which may get committed):

```
wrangler secret put RESEND_API_KEY
```

Paste the key when prompted. Until you do this, clicking "Send Reply" on
an inquiry in the admin panel will automatically fall back to opening the
admin's own email client with the reply pre-filled — so the feature works
either way, it just sends automatically once a real key is set.

## 5. Point media.victoriasugar.ug at it

The Worker needs to answer requests at `https://media.victoriasugar.ug/upload`
and `https://media.victoriasugar.ug/send-email`, since that's what `app.js`
calls (see `UPLOAD_URL` / `SEND_EMAIL_URL` near the top of `app.js`). In the
Cloudflare dashboard:

1. Go to **Workers & Pages → vsl-media-upload → Settings → Triggers**.
2. Under **Routes**, add: `media.victoriasugar.ug/upload*`
3. Add another route: `media.victoriasugar.ug/send-email*`

(If `media.victoriasugar.ug` isn't on the same Cloudflare zone/account as
this Worker, you'll need to either move it there or deploy the Worker to a
different hostname and update `UPLOAD_URL`/`SEND_EMAIL_URL` in `app.js` to
match.)

## 6. Test it

Once deployed and routed, log into the admin panel, open any form with an
upload field (e.g. News → Add New → Cover Image), pick a file, and click
**Upload**. You should see "Uploaded: ..." with a link to the file on
`media.victoriasugar.ug`. Deleting that record should also remove the file
from R2 (check the bucket in the Cloudflare dashboard).

You can also test directly with curl (replace `TOKEN` with a Supabase
access token — open the admin panel, log in, then in the browser console
run `(await db.auth.getSession()).data.session.access_token` and copy it):

```
curl -X POST https://media.victoriasugar.ug/upload \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@/path/to/photo.jpg" \
  -F "folder=images"

curl -X DELETE https://media.victoriasugar.ug/upload \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://media.victoriasugar.ug/images/....jpg"}'
```

## Notes

- **Auth**: every endpoint checks the request's Supabase session token
  against your Supabase project before doing anything — only logged-in
  admins can upload, delete, or send email. No separate password needed.
- **Folders**: files are stored under `images/`, `videos/`, or `docs/`
  inside the bucket depending on which form field triggered the upload.
  Downloads upload into `docs/` — matching `media.victoriasugar.ug/docs/...`
  from your notes.
- **CORS**: `ALLOWED_ORIGIN` in `src/index.js` is set to `*` for now. Once
  your admin panel's real domain is finalized, tighten this to that exact
  origin (e.g. `https://admin.victoriasugar.ug`).
- **File size limit**: 25MB per file, adjustable in `src/index.js`
  (`MAX_BYTES`).
