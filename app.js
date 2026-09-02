// ══════════════════════════════════════
//  VICTORIA SUGAR ADMIN — APP.JS
//  Single index.html shell + this router. Each showPage() call clears
//  #content-area and injects the page's markup, so element ids/handler
//  names are safely reused between pages (only one page is in the DOM
//  at a time).
//
//  This app uses ONLY the public anon Supabase client (`db`, defined in
//  /js/supabase-client.js). There is no service-role key anywhere in
//  browser code. All reads/writes rely on the Row Level Security
//  policies already configured on the database: any signed-in admin
//  can manage all content; the public can only read published rows.
// ══════════════════════════════════════

// Cloudflare Worker that receives raw file uploads/deletes for R2, and
// relays outgoing email for inquiry replies. See /upload-worker.
const UPLOAD_URL = 'https://media.victoriasugar.ug/upload';
const SEND_EMAIL_URL = 'https://media.victoriasugar.ug/send-email';

// ── UTILS ──────────────────────────────

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString() : ''; }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString() : ''; }
function fmtBytes(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  n = Number(n);
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(1) + ' ' + units[i];
}
function pill(text, color) { return `<span class="pill ${color}">${esc(text)}</span>`; }

function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('red', color === 'red');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── MODAL SYSTEM ───────────────────────

function showModal(html, opts = {}) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'active-modal';
  backdrop.innerHTML = `<div class="modal-box" style="${opts.wide ? 'width:44rem;' : ''}">${html}</div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
}
function closeModal() {
  const m = document.getElementById('active-modal');
  if (m) m.remove();
}

// ── FILE UPLOAD / DELETE (Cloudflare R2 via Worker) ────────────────
//
// Renders a file picker + Upload button for a form field. The field's
// actual value (the resulting R2 URL) lives in a hidden input with the
// given `name`, so it flows into FormData/buildPayload exactly like any
// other form field once the upload completes.

async function uploadRawFile(file, folder) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error('Your session expired — please log in again.');

  const fd = new FormData();
  fd.append('file', file);
  fd.append('folder', folder);

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token },
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('Upload failed (' + res.status + ')'));
  return json; // { url, key }
}

// Best-effort delete of an R2 object by its public URL. Never throws —
// storage cleanup failures shouldn't block a database delete.
async function deleteFromR2(url) {
  if (!url) return true;
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return false;
    const res = await fetch(UPLOAD_URL, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function uploadFieldHtml(name, label, currentValue, folder, opts = {}) {
  const uid = name.replace(/[^a-zA-Z0-9]/g, '');
  const accept = folder === 'images' ? 'image/*' : (folder === 'videos' ? 'video/*' : (opts.accept || '*/*'));
  const isImage = folder === 'images';
  return `
    <div class="form-group" data-upload-field="${name}" data-upload-label="${esc(label)}">
      <label class="form-label">${esc(label)}${opts.required ? ' *' : ''}</label>
      <div class="upload-row">
        <input type="file" id="upl-${uid}-file" accept="${accept}" onchange="handleUpload('${name}','${folder}')">
        <button type="button" class="btn btn-outline btn-sm" onclick="handleUpload('${name}','${folder}')">Upload</button>
      </div>
      <input type="hidden" name="${name}" id="upl-${uid}-value" value="${esc(currentValue)}">
      ${opts.captureMeta ? `<input type="hidden" name="${name}_size" id="upl-${uid}-size" value="${esc(opts.currentSize)}"><input type="hidden" name="${name}_type" id="upl-${uid}-type" value="${esc(opts.currentType)}">` : ''}
      ${isImage ? `<img id="upl-${uid}-preview" class="upload-preview" style="${currentValue ? 'display:block;' : ''}" src="${esc(currentValue) || ''}">` : ''}
      <div class="upload-status ${currentValue ? 'success' : ''}" id="upl-${uid}-status" data-uploading="0">${currentValue ? 'Current file: <a href="' + esc(currentValue) + '" target="_blank">' + esc(currentValue.split('/').pop()) + '</a>' : 'No file uploaded yet — choose a file and it will upload automatically.'}</div>
    </div>
  `;
}

async function handleUpload(name, folder) {
  const uid = name.replace(/[^a-zA-Z0-9]/g, '');
  const fileInput = document.getElementById('upl-' + uid + '-file');
  const valueInput = document.getElementById('upl-' + uid + '-value');
  const sizeInput = document.getElementById('upl-' + uid + '-size');
  const typeInput = document.getElementById('upl-' + uid + '-type');
  const status = document.getElementById('upl-' + uid + '-status');
  const preview = document.getElementById('upl-' + uid + '-preview');
  const file = fileInput.files[0];
  if (!file) { showToast('Choose a file first', 'red'); return; }

  // Clear any stale URL immediately, so a failed re-upload can never be
  // mistaken for a successful one still pointing at the old file.
  valueInput.value = '';
  status.dataset.uploading = '1';
  status.className = 'upload-status uploading';
  status.textContent = 'Uploading ' + file.name + '...';

  try {
    const json = await uploadRawFile(file, folder);
    if (!json || !json.url) throw new Error('Upload server did not return a file URL');
    valueInput.value = json.url;
    if (sizeInput) sizeInput.value = file.size;
    if (typeInput) typeInput.value = file.type || '';
    status.className = 'upload-status success';
    status.innerHTML = 'Uploaded: <a href="' + json.url + '" target="_blank">' + json.url.split('/').pop() + '</a>';
    if (preview) { preview.src = json.url; preview.style.display = 'block'; }
    showToast('File uploaded');
  } catch (err) {
    status.className = 'upload-status error';
    status.textContent = 'Upload failed: ' + err.message + ' — fix this and re-select the file before saving.';
    showToast('Upload failed: ' + err.message, 'red');
  } finally {
    status.dataset.uploading = '0';
  }
}

// ── AUTH ───────────────────────────────

async function checkAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = '/login.html'; return null; }
  return session;
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = '/login.html';
});

// ── ROUTER ─────────────────────────────

const PAGE_TITLES = {
  dashboard: 'Dashboard', news: 'News Articles', gallery: 'Gallery',
  careers: 'Job Listings', events: 'Events',
  downloads: 'Downloads', inquiries: 'Inquiries',
  settings: 'Settings',
};

function showPage(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (navEl) navEl.classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[page];
  closeModal();

  const content = document.getElementById('content-area');
  content.innerHTML = '';
  currentEditId = null;

  const pages = {
    dashboard:  renderDashboard,
    news:       el => renderCrudPage(el, newsConfig),
    careers:    el => renderCrudPage(el, careersConfig),
    events:     el => renderCrudPage(el, eventsConfig),
    downloads:  el => renderCrudPage(el, downloadsConfig),
    gallery:    renderGallery,
    inquiries:  renderInquiries,
    settings:   renderSettings,
  };
  (pages[page] || renderDashboard)(content);

  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
}

// ══════════════════════════════════════
//  GENERIC CRUD PAGE FACTORY
//  Used by: news, careers, events, downloads
// ══════════════════════════════════════

let currentEditId = null;

function renderCrudPage(el, cfg) {
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-title">${cfg.pageTitle}</div>
      <button class="btn btn-primary" onclick="openModal()">${cfg.addLabel}</button>
    </div>
    <div class="card" style="padding:0;overflow:auto;">
      <table>
        <thead><tr>${cfg.columns.map(c => `<th>${c.label}</th>`).join('')}<th></th></tr></thead>
        <tbody id="items-body"><tr><td colspan="${cfg.columns.length + 1}" class="empty-state">Loading...</td></tr></tbody>
      </table>
    </div>
  `;

  window.loadItems = async function () {
    const { data, error } = await db.from(cfg.table).select(cfg.listSelect).order(cfg.orderBy, { ascending: cfg.orderAscending });
    const tb = document.getElementById('items-body');
    if (!tb) return;
    if (error) { tb.innerHTML = `<tr><td colspan="${cfg.columns.length + 1}" class="empty-state">Couldn't load: ${esc(error.message)}</td></tr>`; return; }
    if (!data || !data.length) { tb.innerHTML = `<tr><td colspan="${cfg.columns.length + 1}" class="empty-state">${cfg.emptyText}</td></tr>`; return; }
    tb.innerHTML = data.map(row => '<tr>' +
      cfg.columns.map(c => `<td>${c.render(row)}</td>`).join('') +
      `<td style="text-align:right;white-space:nowrap;">` +
      `<button class="btn-link" style="color:var(--green-600);margin-right:.75rem;" onclick="editItem('${row.id}')">Edit</button>` +
      `<button class="btn-link" style="color:var(--red-500);" onclick="deleteItem('${row.id}')">Delete</button>` +
      `</td></tr>`
    ).join('');
  };

  window.openModal = function (data = {}) {
    currentEditId = data.id || null;
    showModal(`
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-title">${currentEditId ? 'Edit' : cfg.addLabel.replace('+ ', '')}</div>
      <form id="item-form">
        ${cfg.formFieldsHtml(data)}
        <div class="modal-error" id="form-error"></div>
        <div class="modal-actions">
          <button type="submit" id="form-submit" class="btn btn-primary" style="flex:1;justify-content:center;">Save</button>
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        </div>
      </form>
    `, { wide: cfg.wideModal });
    if (cfg.afterFormRender) cfg.afterFormRender(data);
    document.getElementById('item-form').addEventListener('submit', handleSubmit);
  };

  window.editItem = async function (id) {
    const { data, error } = await db.from(cfg.table).select('*').eq('id', id).single();
    if (error) { showToast('Failed to load record: ' + error.message, 'red'); return; }
    openModal(data || {});
  };

  window.deleteItem = async function (id) {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    if (cfg.fileFields && cfg.fileFields.length) {
      const { data: row } = await db.from(cfg.table).select(cfg.fileFields.join(',')).eq('id', id).single();
      if (row) {
        for (const f of cfg.fileFields) {
          if (row[f]) {
            const ok = await deleteFromR2(row[f]);
            if (!ok) showToast('Warning: could not remove file from storage', 'red');
          }
        }
      }
    }
    const { error } = await db.from(cfg.table).delete().eq('id', id);
    if (error) { showToast('Delete failed: ' + error.message, 'red'); return; }
    showToast('Deleted');
    loadItems();
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('form-submit');
    const err = document.getElementById('form-error');
    err.style.display = 'none';

    // Guard against saving before an upload has actually finished (or after
    // one failed): a file is chosen in the picker but its hidden URL field
    // is still empty means either it's mid-upload or the upload errored out.
    const pendingUpload = Array.from(e.target.querySelectorAll('[data-upload-field]')).find(group => {
      const fileInput = group.querySelector('input[type="file"]');
      const valueInput = group.querySelector('input[type="hidden"][name]');
      const status = group.querySelector('.upload-status');
      const stillUploading = status && status.dataset.uploading === '1';
      const chosenButNotUploaded = fileInput && fileInput.files.length && valueInput && !valueInput.value;
      return stillUploading || chosenButNotUploaded;
    });
    if (pendingUpload) {
      err.textContent = `"${pendingUpload.dataset.uploadLabel}" is still uploading (or failed) — wait for the green "Uploaded" confirmation, or re-select the file, before saving.`;
      err.style.display = 'block';
      return;
    }

    btn.disabled = true; btn.textContent = 'Saving...';
    if (cfg.syncBeforeSubmit) cfg.syncBeforeSubmit();
    const fd = new FormData(e.target);

    if (cfg.requiredUploads) {
      for (const field of cfg.requiredUploads) {
        if (!fd.get(field)) {
          err.textContent = 'Please upload a file before saving.'; err.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Save';
          return;
        }
      }
    }

    const payload = cfg.buildPayload(fd);
    const { error } = currentEditId
      ? await db.from(cfg.table).update(payload).eq('id', currentEditId)
      : await db.from(cfg.table).insert([payload]);
    if (error) {
      err.textContent = error.message; err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Save';
      return;
    }
    closeModal();
    showToast('Saved');
    loadItems();
  }

  loadItems();
}

// ── CRUD CONFIGS ───────────────────────

const NEWS_CATEGORIES = ['Company News', 'Agriculture', 'Sustainability', 'Community', 'Products', 'Events'];

let newsQuill = null;

const newsConfig = {
  table: 'news', pageTitle: 'News Articles', addLabel: '+ Add New',
  orderBy: 'created_at', orderAscending: false, wideModal: true,
  listSelect: 'id,title,category,is_published,published_date',
  emptyText: 'No articles yet.',
  fileFields: ['cover_image_url'],
  columns: [
    { label: 'Title', render: a => `<strong>${esc(a.title)}</strong>` },
    { label: 'Category', render: a => esc(a.category || '') },
    { label: 'Status', render: a => pill(a.is_published ? 'Published' : 'Draft', a.is_published ? 'green' : 'gray') },
    { label: 'Date', render: a => fmtDate(a.published_date) },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" placeholder="Article title" required></div>
    <div class="form-group"><label class="form-label">Category</label><select class="form-input" name="category">${NEWS_CATEGORIES.map(c => `<option ${data.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Brief Description</label><textarea class="form-input" name="excerpt" rows="2" placeholder="A short summary shown in article previews">${esc(data.excerpt)}</textarea></div>
    ${uploadFieldHtml('cover_image_url', 'Cover Image', data.cover_image_url, 'images')}
    <div class="form-group">
      <label class="form-label">Content</label>
      <div id="news-editor" style="background:#fff;"></div>
      <input type="hidden" name="body_html" id="news-body-html">
    </div>
    <div class="form-group"><label class="form-label">Publish Date</label><input class="form-input" type="date" name="published_date" value="${data.published_date ? data.published_date.split('T')[0] : new Date().toISOString().split('T')[0]}"></div>
    <div class="form-check"><input type="checkbox" id="published" name="is_published" ${data.is_published !== false ? 'checked' : ''}><label class="form-label" for="published">Published (visible on site)</label></div>
  `,
  afterFormRender: data => {
    const editorEl = document.getElementById('news-editor');
    if (!editorEl || typeof Quill === 'undefined') return;
    newsQuill = new Quill('#news-editor', {
      theme: 'snow',
      modules: { toolbar: [['bold', 'italic', 'underline'], [{ header: [2, 3, false] }], [{ list: 'ordered' }, { list: 'bullet' }], ['link', 'image'], ['blockquote', 'clean']] },
    });
    if (data.body_html) newsQuill.root.innerHTML = data.body_html;
    document.getElementById('news-body-html').value = data.body_html || '';
  },
  syncBeforeSubmit: () => {
    if (newsQuill) document.getElementById('news-body-html').value = newsQuill.root.innerHTML;
  },
  buildPayload: fd => ({
    title: fd.get('title'), category: fd.get('category'),
    excerpt: fd.get('excerpt'), body_html: fd.get('body_html'),
    cover_image_url: fd.get('cover_image_url') || null,
    published_date: fd.get('published_date') || new Date().toISOString().split('T')[0],
    is_published: fd.get('is_published') === 'on',
  }),
};

const careersConfig = {
  table: 'careers', pageTitle: 'Job Listings', addLabel: '+ Add New',
  orderBy: 'created_at', orderAscending: false,
  listSelect: 'id,title,department,is_active,deadline',
  emptyText: 'No job listings yet.',
  columns: [
    { label: 'Title', render: j => `<strong>${esc(j.title)}</strong>` },
    { label: 'Department', render: j => esc(j.department || '') },
    { label: 'Status', render: j => pill(j.is_active ? 'Active' : 'Inactive', j.is_active ? 'green' : 'gray') },
    { label: 'Deadline', render: j => fmtDate(j.deadline) },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Job Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Department</label><select class="form-input" name="department">${['Agriculture','Engineering','Finance','HR','Operations','Commercial','IT','Admin'].map(d => `<option ${data.department===d?'selected':''}>${d}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Location</label><input class="form-input" name="location" value="${esc(data.location || 'Masaka, Uganda')}"></div>
    <div class="form-group"><label class="form-label">Deadline</label><input class="form-input" type="date" name="deadline" value="${data.deadline ? data.deadline.split('T')[0] : ''}"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="4">${esc(data.description)}</textarea></div>
    <div class="form-group"><label class="form-label">Requirements</label><textarea class="form-input" name="requirements" rows="3">${esc(data.requirements)}</textarea></div>
    <div class="form-group"><label class="form-label">How to Apply</label><textarea class="form-input" name="how_to_apply" rows="2">${esc(data.how_to_apply)}</textarea></div>
    <div class="form-check"><input type="checkbox" id="active" name="is_active" ${data.is_active !== false ? 'checked' : ''}><label class="form-label" for="active">Active (visible on site)</label></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'), department: fd.get('department'), location: fd.get('location'),
    deadline: fd.get('deadline') || null,
    description: fd.get('description'), requirements: fd.get('requirements'),
    how_to_apply: fd.get('how_to_apply'), is_active: fd.get('is_active') === 'on',
  }),
};

const eventsConfig = {
  table: 'events', pageTitle: 'Events', addLabel: '+ Add New',
  orderBy: 'event_date', orderAscending: false,
  listSelect: 'id,title,location,event_date,is_active',
  emptyText: 'No events yet.',
  fileFields: ['image_url'],
  columns: [
    { label: 'Title', render: e => `<strong>${esc(e.title)}</strong>` },
    { label: 'Location', render: e => esc(e.location || '') },
    { label: 'Date', render: e => fmtDate(e.event_date) },
    { label: 'Status', render: e => pill(e.is_active ? 'Active' : 'Inactive', e.is_active ? 'green' : 'gray') },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Event Date *</label><input class="form-input" type="date" name="event_date" value="${data.event_date ? data.event_date.split('T')[0] : ''}" required></div>
    <div class="form-group"><label class="form-label">End Date</label><input class="form-input" type="date" name="event_end_date" value="${data.event_end_date ? data.event_end_date.split('T')[0] : ''}"></div>
    <div class="form-group"><label class="form-label">Location</label><input class="form-input" name="location" value="${esc(data.location)}" placeholder="e.g. Kampala, Uganda"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="3">${esc(data.description)}</textarea></div>
    ${uploadFieldHtml('image_url', 'Image', data.image_url, 'images')}
    <div class="form-check"><input type="checkbox" id="event-active" name="is_active" ${data.is_active !== false ? 'checked' : ''}><label class="form-label" for="event-active">Active (visible on site)</label></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'),
    event_date: fd.get('event_date') || null,
    event_end_date: fd.get('event_end_date') || null,
    location: fd.get('location'), description: fd.get('description'),
    image_url: fd.get('image_url') || null,
    is_active: fd.get('is_active') === 'on',
  }),
};

const downloadsConfig = {
  table: 'downloads', pageTitle: 'Downloads', addLabel: '+ Add New',
  orderBy: 'created_at', orderAscending: false,
  listSelect: 'id,title,category,file_url,file_size,file_type',
  emptyText: 'No downloads yet.',
  requiredUploads: ['file_url'],
  fileFields: ['file_url'],
  columns: [
    { label: 'Title', render: d => `<strong>${esc(d.title)}</strong>` },
    { label: 'Category', render: d => esc(d.category || '') },
    { label: 'Size', render: d => fmtBytes(d.file_size) },
    { label: 'File', render: d => d.file_url ? `<a href="${esc(d.file_url)}" target="_blank" style="color:var(--green-600);">Open →</a>` : '' },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Category</label><input class="form-input" name="category" value="${esc(data.category)}" placeholder="e.g. Annual Report, Policy, Brochure"></div>
    ${uploadFieldHtml('file_url', 'File', data.file_url, 'docs', { required: true, captureMeta: true, currentSize: data.file_size, currentType: data.file_type })}
  `,
  buildPayload: fd => ({
    title: fd.get('title'), category: fd.get('category') || null,
    file_url: fd.get('file_url'),
    file_size: fd.get('file_url_size') ? parseInt(fd.get('file_url_size'), 10) : null,
    file_type: fd.get('file_url_type') || null,
  }),
};

// ══════════════════════════════════════
//  PAGE: DASHBOARD
// ══════════════════════════════════════

async function renderDashboard(el) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-header-title">Dashboard</div>
        <div class="page-header-sub">Welcome back. Here's an overview of your website content.</div>
      </div>
    </div>
    <div class="grid-4">
      <div class="stat-card"><div class="stat-label">Published News</div><div class="stat-value" id="stat-news">—</div></div>
      <div class="stat-card"><div class="stat-label">Active Jobs</div><div class="stat-value" id="stat-jobs">—</div></div>
      <div class="stat-card"><div class="stat-label">Unread Inquiries</div><div class="stat-value" id="stat-inq">—</div></div>
      <div class="stat-card"><div class="stat-label">Downloads</div><div class="stat-value" id="stat-dl">—</div></div>
    </div>
    <div class="card" style="margin-bottom:1.5rem;">
      <div class="card-header">
        <div class="card-title">Recent Inquiries</div>
        <a href="#" onclick="showPage('inquiries');return false;" style="color:var(--green-600);font-size:.875rem;text-decoration:none;font-weight:500;">View all →</a>
      </div>
      <div id="recent-inq"><p class="empty-state">Loading...</p></div>
    </div>
    <div class="grid-4">
      <a href="#" class="action-card" onclick="showPage('news');return false;"><div class="icon">📰</div><div class="label">Add News</div></a>
      <a href="#" class="action-card" onclick="showPage('careers');return false;"><div class="icon">💼</div><div class="label">Post Job</div></a>
      <a href="#" class="action-card" onclick="showPage('events');return false;"><div class="icon">📅</div><div class="label">Add Event</div></a>
      <a href="#" class="action-card" onclick="showPage('gallery');return false;"><div class="icon">🖼️</div><div class="label">Upload Photo</div></a>
    </div>
  `;

  const [newsRes, jobsRes, inqRes, dlRes] = await Promise.all([
    db.from('news').select('id', { count: 'exact', head: true }).eq('is_published', true),
    db.from('careers').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db.from('inquiries').select('id', { count: 'exact', head: true }).eq('is_read', false),
    db.from('downloads').select('id', { count: 'exact', head: true }),
  ]);
  document.getElementById('stat-news').textContent = newsRes.count ?? '—';
  document.getElementById('stat-jobs').textContent = jobsRes.count ?? '—';
  document.getElementById('stat-inq').textContent = inqRes.count ?? '—';
  document.getElementById('stat-dl').textContent = dlRes.count ?? '—';

  const { data } = await db.from('inquiries').select('*').order('created_at', { ascending: false }).limit(5);
  const box = document.getElementById('recent-inq');
  if (!data || !data.length) { box.innerHTML = '<p class="empty-state">No inquiries yet.</p>'; return; }
  box.innerHTML = '<table><thead><tr><th>Name</th><th>Subject</th><th>Date</th><th>Status</th></tr></thead><tbody>' +
    data.map(i => `<tr><td><strong>${esc(i.name || '')}</strong></td><td>${esc(i.subject || '')}</td><td style="font-size:.75rem;color:var(--gray-500);">${fmtDate(i.created_at)}</td><td>${!i.is_read ? pill('New', 'amber') : (i.replied ? pill('Replied', 'green') : pill('Read', 'gray'))}</td></tr>`).join('') +
    '</tbody></table>';
}

// ══════════════════════════════════════
//  PAGE: GALLERY
// ══════════════════════════════════════

async function renderGallery(el) {
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-title">Gallery</div>
      <div style="display:flex;gap:.75rem;">
        <button class="btn btn-outline btn-sm" onclick="openAlbumsModal()">Manage Albums</button>
        <button class="btn btn-primary btn-sm" onclick="openPhotoModal()">+ Add Photo</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:1.5rem;">
      <div class="card-title" style="margin-bottom:1rem;">Albums</div>
      <div id="albums-list" class="tab-bar"></div>
      <div style="font-size:.75rem;color:var(--gray-500);">Click an album to filter photos below.</div>
    </div>
    <div id="photos-grid" class="photo-grid"></div>
  `;

  let albums = [], filterAlbum = 'all';

  window.setGalleryFilter = function (id) { filterAlbum = id; renderAlbumTabs(); loadPhotos(); };

  function renderAlbumTabs() {
    const alEl = document.getElementById('albums-list');
    if (!alEl) return;
    alEl.innerHTML = `<button class="album-tab-btn ${filterAlbum === 'all' ? 'active-tab' : ''}" onclick="setGalleryFilter('all')">All</button>` +
      albums.map(a => `<button class="album-tab-btn ${filterAlbum === a.id ? 'active-tab' : ''}" onclick="setGalleryFilter('${a.id}')">${esc(a.title)}</button>`).join('');
  }

  async function loadAlbums() {
    const { data: al, error } = await db.from('gallery_albums').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) { showToast('Could not load albums: ' + error.message, 'red'); }
    albums = al || [];
    renderAlbumTabs();
    loadPhotos();
  }

  async function loadPhotos() {
    const grid = document.getElementById('photos-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Loading...</div>';
    let q = db.from('gallery_items').select('id,type,url,thumbnail_url,title,album_id').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (filterAlbum !== 'all') q = q.eq('album_id', filterAlbum);
    const { data, error } = await q;
    if (error) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Couldn't load: ${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No photos yet. Click + Add Photo to upload.</div>'; return; }
    grid.innerHTML = data.map(p => `
      <div class="photo-tile">
        ${p.type === 'video'
          ? `<video src="${esc(p.url)}" muted preload="metadata"></video><span class="pill amber" style="position:absolute;top:.5rem;left:.5rem;">VIDEO</span>`
          : `<img src="${esc(p.thumbnail_url || p.url)}" loading="lazy">`}
        <div class="photo-overlay">
          <button class="photo-delete" onclick="deletePhoto('${p.id}')">Delete</button>
          ${p.title ? `<div class="photo-caption">${esc(p.title)}</div>` : ''}
        </div>
      </div>`).join('');
  }

  // ── Add Photo/Video (multi-file, with preview) ──────────────────

  let pendingFiles = [];

  window.openPhotoModal = function () {
    pendingFiles = [];
    showModal(`
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-title">Add Photos / Videos</div>
      <form id="photo-form">
        <div class="form-group">
          <label class="form-label">Files * (images or videos, multiple allowed)</label>
          <input type="file" id="photo-files" accept="image/*,video/*" multiple>
        </div>
        <div id="photo-preview-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:.5rem;margin-bottom:1rem;"></div>
        <div class="form-group"><label class="form-label">Caption (applied to all)</label><input class="form-input" name="caption" placeholder="Optional caption"></div>
        <div class="form-group"><label class="form-label">Album</label><select class="form-input" name="album_id"><option value="">No album</option>${albums.map(a => `<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select></div>
        <div class="modal-error" id="photo-err"></div>
        <div id="photo-upload-status" style="font-size:.75rem;color:var(--gray-500);margin-bottom:.75rem;"></div>
        <button type="submit" id="photo-submit" class="btn btn-primary" style="width:100%;justify-content:center;">Upload</button>
      </form>
    `);

    document.getElementById('photo-files').addEventListener('change', e => {
      pendingFiles = Array.from(e.target.files || []);
      const grid = document.getElementById('photo-preview-grid');
      grid.innerHTML = pendingFiles.map((f, i) => {
        const isVideo = f.type.startsWith('video/');
        const objUrl = URL.createObjectURL(f);
        return `<div style="position:relative;aspect-ratio:1;border-radius:.5rem;overflow:hidden;background:var(--gray-100);">
          ${isVideo ? `<video src="${objUrl}" muted style="width:100%;height:100%;object-fit:cover;"></video>` : `<img src="${objUrl}" style="width:100%;height:100%;object-fit:cover;">`}
          <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:.625rem;padding:2px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</div>
        </div>`;
      }).join('');
    });

    document.getElementById('photo-form').addEventListener('submit', async e => {
      e.preventDefault();
      const err = document.getElementById('photo-err');
      const status = document.getElementById('photo-upload-status');
      const btn = document.getElementById('photo-submit');
      err.style.display = 'none';
      if (!pendingFiles.length) { err.textContent = 'Choose at least one file.'; err.style.display = 'block'; return; }

      const fd = new FormData(e.target);
      const caption = fd.get('caption') || null;
      const albumId = fd.get('album_id') || null;

      btn.disabled = true; btn.textContent = 'Uploading...';
      let ok = 0, fail = 0;
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        const isVideo = file.type.startsWith('video/');
        status.textContent = `Uploading ${i + 1} of ${pendingFiles.length}: ${file.name}...`;
        try {
          const uploaded = await uploadRawFile(file, isVideo ? 'videos' : 'images');
          const { error } = await db.from('gallery_items').insert([{
            album_id: albumId, type: isVideo ? 'video' : 'image',
            url: uploaded.url, title: caption, file_name: file.name, file_size: file.size,
          }]);
          if (error) throw error;
          ok++;
        } catch (e2) {
          fail++;
        }
      }
      status.textContent = `Done: ${ok} uploaded${fail ? ', ' + fail + ' failed' : ''}.`;
      showToast(fail ? `Uploaded ${ok}, ${fail} failed` : 'Upload complete', fail ? 'red' : undefined);
      btn.disabled = false; btn.textContent = 'Upload';
      if (ok) { closeModal(); loadPhotos(); }
    });
  };

  window.deletePhoto = async function (id) {
    if (!confirm('Delete this item? It will also be removed from Cloudflare storage.')) return;
    const { data: row } = await db.from('gallery_items').select('url').eq('id', id).single();
    if (row && row.url) await deleteFromR2(row.url);
    const { error } = await db.from('gallery_items').delete().eq('id', id);
    if (error) { showToast('Delete failed: ' + error.message, 'red'); return; }
    showToast('Deleted'); loadPhotos();
  };

  // ── Manage Albums (add/edit/delete) ──────────────────────────────

  window.openAlbumsModal = function () {
    showModal(`
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-title">Manage Albums</div>
      <div id="albums-manage-list" style="margin-bottom:1.5rem;max-height:16rem;overflow-y:auto;"></div>
      <div class="card-title" style="font-size:.875rem;margin-bottom:.75rem;">Add New Album</div>
      <form id="album-form">
        <div class="form-group"><label class="form-label">Album Name *</label><input class="form-input" name="title" required></div>
        <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="2"></textarea></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Create Album</button>
      </form>
    `, { wide: true });
    renderAlbumsManageList();

    document.getElementById('album-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const { error } = await db.from('gallery_albums').insert([{ title: fd.get('title'), description: fd.get('description') || null, is_published: true }]);
      if (error) { showToast('Failed: ' + error.message, 'red'); return; }
      e.target.reset();
      showToast('Album created');
      await loadAlbums();
      renderAlbumsManageList();
    });
  };

  function renderAlbumsManageList() {
    const box = document.getElementById('albums-manage-list');
    if (!box) return;
    if (!albums.length) { box.innerHTML = '<div class="empty-state">No albums yet.</div>'; return; }
    box.innerHTML = albums.map(a => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--gray-100);">
        <div>
          <strong>${esc(a.title)}</strong>
          ${a.is_published ? '' : pill('Hidden', 'gray')}
          <div style="font-size:.75rem;color:var(--gray-500);">${esc(a.description || '')}</div>
        </div>
        <div style="white-space:nowrap;">
          <button class="btn-link" style="color:var(--green-600);margin-right:.75rem;" onclick="editAlbum('${a.id}')">Edit</button>
          <button class="btn-link" style="color:var(--red-500);" onclick="deleteAlbum('${a.id}')">Delete</button>
        </div>
      </div>`).join('');
  }

  window.editAlbum = function (id) {
    const a = albums.find(x => x.id === id);
    if (!a) return;
    showModal(`
      <button class="modal-close" onclick="openAlbumsModal()">&times;</button>
      <div class="modal-title">Edit Album</div>
      <form id="album-edit-form">
        <div class="form-group"><label class="form-label">Album Name *</label><input class="form-input" name="title" value="${esc(a.title)}" required></div>
        <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="2">${esc(a.description)}</textarea></div>
        <div class="form-check"><input type="checkbox" id="album-pub" name="is_published" ${a.is_published !== false ? 'checked' : ''}><label class="form-label" for="album-pub">Published (visible on site)</label></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary" style="flex:1;justify-content:center;">Save</button>
          <button type="button" class="btn btn-outline" onclick="openAlbumsModal()">Cancel</button>
        </div>
      </form>
    `);
    document.getElementById('album-edit-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const { error } = await db.from('gallery_albums').update({
        title: fd.get('title'), description: fd.get('description') || null,
        is_published: fd.get('is_published') === 'on',
      }).eq('id', id);
      if (error) { showToast('Failed: ' + error.message, 'red'); return; }
      showToast('Album updated');
      await loadAlbums();
      openAlbumsModal();
    });
  };

  window.deleteAlbum = async function (id) {
    if (!confirm('Delete this album? All photos/videos inside it will also be deleted, including from Cloudflare storage. This cannot be undone.')) return;
    const { data: items } = await db.from('gallery_items').select('url').eq('album_id', id);
    if (items && items.length) {
      for (const it of items) { if (it.url) await deleteFromR2(it.url); }
    }
    const { error } = await db.from('gallery_albums').delete().eq('id', id);
    if (error) { showToast('Delete failed: ' + error.message, 'red'); return; }
    showToast('Album deleted');
    if (filterAlbum === id) filterAlbum = 'all';
    await loadAlbums();
    openAlbumsModal();
  };

  loadAlbums();
}

// ══════════════════════════════════════
//  PAGE: INQUIRIES
// ══════════════════════════════════════

async function renderInquiries(el) {
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-title">Inquiries</div>
      <select class="form-input" id="status-filter" style="max-width:12rem;">
        <option value="all">All</option>
        <option value="unread">Unread</option>
        <option value="read">Read</option>
        <option value="replied">Replied</option>
      </select>
    </div>
    <div class="card" style="padding:0;overflow:auto;">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Subject</th><th>Date</th><th>Status</th><th></th></tr></thead>
        <tbody id="inq-body"><tr><td colspan="6" class="empty-state">Loading...</td></tr></tbody>
      </table>
    </div>
  `;

  let currentId = null, currentInquiry = null;

  window.loadInquiries = async function () {
    const filter = document.getElementById('status-filter').value;
    let q = db.from('inquiries').select('*').order('created_at', { ascending: false }).limit(100);
    if (filter === 'unread') q = q.eq('is_read', false);
    else if (filter === 'read') q = q.eq('is_read', true).eq('replied', false);
    else if (filter === 'replied') q = q.eq('replied', true);
    const { data, error } = await q;
    const tb = document.getElementById('inq-body');
    if (!tb) return;
    if (error) { tb.innerHTML = `<tr><td colspan="6" class="empty-state">Couldn't load: ${esc(error.message)}</td></tr>`; return; }
    if (!data || !data.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-state">No inquiries found.</td></tr>'; return; }
    tb.innerHTML = data.map(i => `
      <tr style="cursor:pointer" onclick="viewInquiry('${i.id}')">
        <td><strong>${esc(i.name || '')}</strong></td>
        <td>${esc(i.email || '')}</td>
        <td>${esc(i.subject || '')}</td>
        <td style="font-size:.75rem;color:var(--gray-500);">${fmtDate(i.created_at)}</td>
        <td>${i.replied ? pill('Replied', 'green') : (i.is_read ? pill('Read', 'gray') : pill('New', 'amber'))}</td>
        <td style="text-align:right;color:var(--gray-300);">→</td>
      </tr>`).join('');
  };

  window.viewInquiry = async function (id) {
    currentId = id;
    const { data, error } = await db.from('inquiries').select('*').eq('id', id).single();
    if (error || !data) { showToast('Failed to load inquiry', 'red'); return; }
    currentInquiry = data;
    showModal(`
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-title">Inquiry Detail</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:1.25rem;">
        ${[['Name', esc(data.name)], ['Email', `<a href="mailto:${esc(data.email)}" style="color:var(--green-600)">${esc(data.email)}</a>`], ['Phone', esc(data.phone) || '—'], ['Subject', esc(data.subject) || '—'], ['Type', esc(data.inquiry_type) || 'general'], ['Date', fmtDateTime(data.created_at)]]
          .map(([k, v]) => `<tr style="border-bottom:1px solid var(--gray-100)"><td style="padding:.5rem 0;font-size:.875rem;color:var(--gray-500);width:35%;">${k}</td><td style="padding:.5rem 0;font-size:.875rem;font-weight:500;">${v}</td></tr>`).join('')}
      </table>
      <div style="font-size:.875rem;color:var(--gray-500);font-weight:500;margin-bottom:.5rem;">Message:</div>
      <div style="background:var(--gray-50);border-radius:.5rem;padding:1rem;font-size:.875rem;color:var(--gray-700);line-height:1.7;margin-bottom:1.5rem;">${esc(data.message || '')}</div>
      ${data.replied ? `<div style="background:var(--green-50);border-radius:.5rem;padding:1rem;font-size:.8125rem;color:var(--green-700);margin-bottom:1.5rem;"><strong>Replied</strong> on ${fmtDateTime(data.replied_at)}<br>${esc(data.reply_message || '')}</div>` : ''}
      <div style="font-size:.875rem;color:var(--gray-500);font-weight:500;margin-bottom:.5rem;">Respond:</div>
      <form id="reply-form" style="margin-bottom:1rem;">
        <div class="form-group"><input class="form-input" name="subject" value="Re: ${esc(data.subject || 'Your inquiry')}" required></div>
        <div class="form-group"><textarea class="form-input" name="message" rows="5" placeholder="Type your reply..." required>Hi ${esc(data.name || '')},\n\nThank you for reaching out to Victoria Sugar Limited.\n\n</textarea></div>
        <div class="modal-error" id="reply-err"></div>
        <button type="submit" class="btn btn-primary btn-sm">Send Reply</button>
      </form>
      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="toggleInquiryRead()">${data.is_read ? 'Mark Unread' : 'Mark Read'}</button>
      </div>
    `, { wide: true });

    document.getElementById('reply-form').addEventListener('submit', sendInquiryReply);

    if (!data.is_read) await db.from('inquiries').update({ is_read: true }).eq('id', id);
  };

  window.toggleInquiryRead = async function () {
    if (!currentId || !currentInquiry) return;
    await db.from('inquiries').update({ is_read: !currentInquiry.is_read }).eq('id', currentId);
    closeModal(); showToast('Updated'); loadInquiries();
  };

  async function sendInquiryReply(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const subject = fd.get('subject'), message = fd.get('message');
    const err = document.getElementById('reply-err');
    err.style.display = 'none';
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Sending...';

    let sent = false;
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch(SEND_EMAIL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session ? session.access_token : '') },
        body: JSON.stringify({ to: currentInquiry.email, subject, message }),
      });
      sent = res.ok;
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Email service unavailable'); }
    } catch (e2) {
      // Fall back to opening the admin's own mail client with everything pre-filled.
      const mailto = `mailto:${encodeURIComponent(currentInquiry.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      window.open(mailto, '_blank');
      showToast('Automatic sending is not configured yet — opened your email client instead');
    }

    await db.from('inquiries').update({ replied: true, replied_at: new Date().toISOString(), reply_message: message, is_read: true }).eq('id', currentId);
    btn.disabled = false; btn.textContent = 'Send Reply';
    closeModal();
    showToast(sent ? 'Reply sent' : 'Marked as replied');
    loadInquiries();
  }

  document.getElementById('status-filter').addEventListener('change', loadInquiries);
  loadInquiries();
}

// ══════════════════════════════════════
//  PAGE: SETTINGS
// ══════════════════════════════════════

async function renderSettings(el) {
  el.innerHTML = `
    <div class="page-header"><div class="page-header-title">Settings</div></div>
    <div class="grid-2">
      <div class="card">
        <div class="card-title" style="margin-bottom:1rem;">Admin Profile</div>
        <form id="profile-form">
          <div class="form-group"><label class="form-label">Name</label><input class="form-input" name="display_name" id="profile-name"></div>
          <div class="form-group"><label class="form-label">Login Email</label><input class="form-input" type="email" name="email" id="profile-email"></div>
          <div class="modal-error" id="profile-msg"></div>
          <button type="submit" class="btn btn-primary">Save Profile</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:1rem;">Change Password</div>
        <form id="pw-form">
          <div class="form-group"><label class="form-label">Current Password</label><input type="password" class="form-input" name="current" required></div>
          <div class="form-group"><label class="form-label">New Password</label><input type="password" class="form-input" name="new" required minlength="6"></div>
          <div class="form-group"><label class="form-label">Confirm New Password</label><input type="password" class="form-input" name="confirm" required></div>
          <div class="modal-error" id="pw-msg"></div>
          <button type="submit" class="btn btn-primary">Update Password</button>
        </form>
      </div>
    </div>
    <div class="card" style="margin-top:1.5rem;">
      <div class="card-title" style="margin-bottom:1rem;">Account Info</div>
      <div id="acct-info" style="color:var(--gray-500);font-size:.875rem;line-height:1.8;"></div>
    </div>
  `;

  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  const { data: profile } = await db.from('admin_profile').select('*').eq('id', user.id).single();
  document.getElementById('profile-name').value = (profile && profile.display_name) || '';
  document.getElementById('profile-email').value = user.email || '';
  document.getElementById('acct-info').innerHTML =
    `<strong>Email:</strong> ${esc(user.email)}<br><strong>Role:</strong> Admin<br><strong>Last Sign In:</strong> ${user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '—'}`;

  document.getElementById('profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('profile-msg');
    msg.style.display = 'none';
    const fd = new FormData(e.target);
    const newName = fd.get('display_name');
    const newEmail = fd.get('email').trim();

    const { error: profErr } = await db.from('admin_profile').update({ display_name: newName }).eq('id', user.id);
    if (profErr) { msg.style.color = 'var(--red-500)'; msg.textContent = profErr.message; msg.style.display = 'block'; return; }

    if (newEmail && newEmail.toLowerCase() !== (user.email || '').toLowerCase()) {
      const { error: emailErr } = await db.auth.updateUser({ email: newEmail });
      if (emailErr) { msg.style.color = 'var(--red-500)'; msg.textContent = emailErr.message; msg.style.display = 'block'; return; }
      await db.from('site_settings').update({ value: newEmail, updated_at: new Date().toISOString() }).eq('key', 'admin_email');
      msg.style.color = 'var(--green-600)';
      msg.textContent = 'Profile saved. Check your new email inbox to confirm the address change.';
    } else {
      msg.style.color = 'var(--green-600)';
      msg.textContent = 'Profile saved.';
    }
    msg.style.display = 'block';
    document.getElementById('admin-user').textContent = newName || user.email;
  });

  document.getElementById('pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('pw-msg');
    const fd = new FormData(e.target);
    msg.style.display = 'none';
    if (fd.get('new') !== fd.get('confirm')) { msg.style.color = 'var(--red-500)'; msg.textContent = 'Passwords do not match.'; msg.style.display = 'block'; return; }

    const { error: reauthErr } = await db.auth.signInWithPassword({ email: user.email, password: fd.get('current') });
    if (reauthErr) { msg.style.color = 'var(--red-500)'; msg.textContent = 'Current password is incorrect.'; msg.style.display = 'block'; return; }

    const { error } = await db.auth.updateUser({ password: fd.get('new') });
    if (error) { msg.style.color = 'var(--red-500)'; msg.textContent = error.message; }
    else { msg.style.color = 'var(--green-600)'; msg.textContent = 'Password updated successfully.'; e.target.reset(); }
    msg.style.display = 'block';
  });
}

// ══════════════════════════════════════
//  BOOT
// ══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  checkAuth().then(async session => {
    if (!session) return;
    const { data: profile } = await db.from('admin_profile').select('display_name').eq('id', session.user.id).single();
    document.getElementById('admin-user').textContent = (profile && profile.display_name) || session.user.email;
    showPage('dashboard');
  });
});
