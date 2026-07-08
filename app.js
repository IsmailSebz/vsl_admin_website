// ══════════════════════════════════════
//  VICTORIA SUGAR ADMIN — APP.JS
//  Single index.html shell + this router. Each showPage() call clears
//  #content-area and injects the page's markup, so element ids/handler
//  names are safely reused between pages (only one page is in the DOM
//  at a time).
// ══════════════════════════════════════

const SUPABASE_URL = 'https://ffsddbbtgoxbqlrnvcrm.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmc2RkYmJ0Z294YnFscm52Y3JtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjY0MTMxNCwiZXhwIjoyMDk4MjE3MzE0fQ.OJVRH623HKsMbGah9Zj3zfHLQZOgAR1zNy6fHqJ-3JA';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmc2RkYmJ0Z294YnFscm52Y3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDEzMTQsImV4cCI6MjA5ODIxNzMxNH0.EYNEFQqUR7ZV63XCHKo_RuS2tIJRxN1VfF6Tx3BAb3I';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const dbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── UTILS ──────────────────────────────

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString() : ''; }
function pill(text, color) { return `<span class="pill ${color}">${text}</span>`; }

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

function showModal(html) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'active-modal';
  backdrop.innerHTML = `<div class="modal-box">${html}</div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
}
function closeModal() {
  const m = document.getElementById('active-modal');
  if (m) m.remove();
}

// ── AUTH ───────────────────────────────

async function checkAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = '/admin/login.html'; return null; }
  return session;
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = '/admin/login.html';
});

// ── ROUTER ─────────────────────────────

const PAGE_TITLES = {
  dashboard: 'Dashboard', news: 'News Articles', gallery: 'Gallery',
  careers: 'Job Listings', tenders: 'Tenders', events: 'Events',
  press: 'Press Room', downloads: 'Downloads', inquiries: 'Inquiries',
  newsletter: 'Newsletter Subscribers', settings: 'Settings',
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
    tenders:    el => renderCrudPage(el, tendersConfig),
    events:     el => renderCrudPage(el, eventsConfig),
    press:      el => renderCrudPage(el, pressConfig),
    downloads:  el => renderCrudPage(el, downloadsConfig),
    gallery:    renderGallery,
    inquiries:  renderInquiries,
    newsletter: renderNewsletter,
    settings:   renderSettings,
  };
  (pages[page] || renderDashboard)(content);

  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
}

// ══════════════════════════════════════
//  GENERIC CRUD PAGE FACTORY
//  Used by: news, careers, tenders, events, press, downloads
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
    const { data } = await dbAdmin.from(cfg.table).select(cfg.listSelect).order(cfg.orderBy, { ascending: cfg.orderAscending });
    const tb = document.getElementById('items-body');
    if (!tb) return;
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
    `);
    document.getElementById('item-form').addEventListener('submit', handleSubmit);
  };

  window.editItem = async function (id) {
    const { data } = await dbAdmin.from(cfg.table).select('*').eq('id', id).single();
    openModal(data || {});
  };

  window.deleteItem = async function (id) {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    await dbAdmin.from(cfg.table).delete().eq('id', id);
    showToast('Deleted');
    loadItems();
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('form-submit');
    const err = document.getElementById('form-error');
    btn.disabled = true; btn.textContent = 'Saving...'; err.style.display = 'none';
    const fd = new FormData(e.target);
    const payload = cfg.buildPayload(fd);
    const { error } = currentEditId
      ? await dbAdmin.from(cfg.table).update(payload).eq('id', currentEditId)
      : await dbAdmin.from(cfg.table).insert([payload]);
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

const newsConfig = {
  table: 'news_articles', pageTitle: 'News Articles', addLabel: '+ Add New',
  orderBy: 'created_at', orderAscending: false,
  listSelect: 'id,title,category,published,published_at',
  emptyText: 'No articles yet.',
  columns: [
    { label: 'Title', render: a => `<strong>${a.title}</strong>` },
    { label: 'Category', render: a => a.category || '' },
    { label: 'Status', render: a => pill(a.published ? 'Published' : 'Draft', a.published ? 'green' : 'gray') },
    { label: 'Date', render: a => fmtDate(a.published_at) },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" placeholder="Article title" required></div>
    <div class="form-group"><label class="form-label">Category</label><select class="form-input" name="category">${['Company News','Agriculture','Sustainability','Community','Products','Events'].map(c => `<option ${data.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Excerpt</label><textarea class="form-input" name="excerpt" rows="2">${esc(data.excerpt)}</textarea></div>
    <div class="form-group"><label class="form-label">Content (HTML)</label><textarea class="form-input" name="content" rows="6">${esc(data.content)}</textarea></div>
    <div class="form-group"><label class="form-label">Image URL</label><input class="form-input" name="image_url" value="${esc(data.image_url)}" placeholder="https://media.victoriasugar.ug/images/..."></div>
    <div class="form-group"><label class="form-label">Publish Date</label><input class="form-input" type="date" name="published_at" value="${data.published_at ? data.published_at.split('T')[0] : new Date().toISOString().split('T')[0]}"></div>
    <div class="form-check"><input type="checkbox" id="published" name="published" ${data.published !== false ? 'checked' : ''}><label class="form-label" for="published">Published (visible on site)</label></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'), category: fd.get('category'),
    excerpt: fd.get('excerpt'), content: fd.get('content'),
    image_url: fd.get('image_url') || null,
    published_at: fd.get('published_at') ? new Date(fd.get('published_at')).toISOString() : new Date().toISOString(),
    published: fd.get('published') === 'on',
  }),
};

const careersConfig = {
  table: 'job_listings', pageTitle: 'Job Listings', addLabel: '+ Add New',
  orderBy: 'created_at', orderAscending: false,
  listSelect: 'id,title,department,type,active,closing_date',
  emptyText: 'No job listings yet.',
  columns: [
    { label: 'Title', render: j => `<strong>${j.title}</strong>` },
    { label: 'Department', render: j => j.department || '' },
    { label: 'Type', render: j => j.type || '' },
    { label: 'Status', render: j => pill(j.active ? 'Active' : 'Inactive', j.active ? 'green' : 'gray') },
    { label: 'Closing Date', render: j => fmtDate(j.closing_date) },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Job Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Department</label><select class="form-input" name="department">${['Agriculture','Engineering','Finance','HR','Operations','Commercial','IT','Admin'].map(d => `<option ${data.department===d?'selected':''}>${d}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Location</label><input class="form-input" name="location" value="${esc(data.location)}" placeholder="e.g. Luwero, Uganda"></div>
    <div class="form-group"><label class="form-label">Type</label><select class="form-input" name="type">${['Full-time','Part-time','Contract','Internship'].map(t => `<option ${data.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Closing Date</label><input class="form-input" type="date" name="closing_date" value="${data.closing_date ? data.closing_date.split('T')[0] : ''}"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="4">${esc(data.description)}</textarea></div>
    <div class="form-check"><input type="checkbox" id="active" name="active" ${data.active !== false ? 'checked' : ''}><label class="form-label" for="active">Active (visible on site)</label></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'), department: fd.get('department'), location: fd.get('location'),
    type: fd.get('type'), closing_date: fd.get('closing_date') || null,
    description: fd.get('description'), active: fd.get('active') === 'on',
  }),
};

const tendersConfig = {
  table: 'tenders', pageTitle: 'Tenders', addLabel: '+ Add New',
  orderBy: 'deadline', orderAscending: false,
  listSelect: 'id,title,reference,deadline',
  emptyText: 'No tenders yet.',
  columns: [
    { label: 'Title', render: t => `<strong>${t.title}</strong>` },
    { label: 'Ref', render: t => t.reference || '—' },
    { label: 'Deadline', render: t => fmtDate(t.deadline) },
    { label: 'Status', render: t => { const dl = t.deadline ? new Date(t.deadline) : null; const open = dl && dl > new Date(); return pill(open ? 'Open' : 'Closed', open ? 'green' : 'gray'); } },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Reference Number</label><input class="form-input" name="reference" value="${esc(data.reference)}" placeholder="e.g. VSL/PROC/2026/001"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="3">${esc(data.description)}</textarea></div>
    <div class="form-group"><label class="form-label">Deadline *</label><input class="form-input" type="date" name="deadline" value="${data.deadline ? data.deadline.split('T')[0] : ''}" required></div>
    <div class="form-group"><label class="form-label">Document URL (PDF)</label><input class="form-input" name="file_url" value="${esc(data.file_url)}" placeholder="https://..."></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'), reference: fd.get('reference') || null,
    description: fd.get('description'),
    deadline: fd.get('deadline') ? new Date(fd.get('deadline')).toISOString() : null,
    file_url: fd.get('file_url') || null,
  }),
};

const eventsConfig = {
  table: 'events', pageTitle: 'Events', addLabel: '+ Add New',
  orderBy: 'event_date', orderAscending: false,
  listSelect: 'id,title,location,event_date',
  emptyText: 'No events yet.',
  columns: [
    { label: 'Title', render: e => `<strong>${e.title}</strong>` },
    { label: 'Location', render: e => e.location || '' },
    { label: 'Date', render: e => fmtDate(e.event_date) },
    { label: 'Status', render: e => { const d = e.event_date ? new Date(e.event_date) : null; const up = d && d > new Date(); return pill(up ? 'Upcoming' : 'Past', up ? 'green' : 'gray'); } },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Event Date *</label><input class="form-input" type="datetime-local" name="event_date" value="${data.event_date ? data.event_date.slice(0,16) : ''}" required></div>
    <div class="form-group"><label class="form-label">Location</label><input class="form-input" name="location" value="${esc(data.location)}" placeholder="e.g. Kampala, Uganda"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="3">${esc(data.description)}</textarea></div>
    <div class="form-group"><label class="form-label">Image URL</label><input class="form-input" name="image_url" value="${esc(data.image_url)}" placeholder="https://..."></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'),
    event_date: fd.get('event_date') ? new Date(fd.get('event_date')).toISOString() : null,
    location: fd.get('location'), description: fd.get('description'),
    image_url: fd.get('image_url') || null,
  }),
};

const pressConfig = {
  table: 'press_releases', pageTitle: 'Press Room', addLabel: '+ Add Release',
  orderBy: 'created_at', orderAscending: false,
  listSelect: 'id,title,category,published,published_at',
  emptyText: 'No press releases yet.',
  columns: [
    { label: 'Title', render: p => `<strong>${p.title}</strong>` },
    { label: 'Category', render: p => p.category || '' },
    { label: 'Date', render: p => fmtDate(p.published_at) },
    { label: 'Status', render: p => pill(p.published ? 'Published' : 'Draft', p.published ? 'green' : 'gray') },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Category</label><select class="form-input" name="category">${['Press Release','Statement','Announcement'].map(c => `<option ${data.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Summary</label><textarea class="form-input" name="summary" rows="3">${esc(data.summary)}</textarea></div>
    <div class="form-group"><label class="form-label">PDF File URL</label><input class="form-input" name="file_url" value="${esc(data.file_url)}" placeholder="https://..."></div>
    <div class="form-group"><label class="form-label">Publish Date</label><input class="form-input" type="date" name="published_at" value="${data.published_at ? data.published_at.split('T')[0] : new Date().toISOString().split('T')[0]}"></div>
    <div class="form-check"><input type="checkbox" id="press-published" name="published" ${data.published !== false ? 'checked' : ''}><label class="form-label" for="press-published">Published</label></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'), category: fd.get('category'), summary: fd.get('summary'),
    file_url: fd.get('file_url') || null,
    published_at: fd.get('published_at') ? new Date(fd.get('published_at')).toISOString() : new Date().toISOString(),
    published: fd.get('published') === 'on',
  }),
};

const downloadsConfig = {
  table: 'downloads', pageTitle: 'Downloads', addLabel: '+ Add New',
  orderBy: 'created_at', orderAscending: false,
  listSelect: 'id,title,description,published',
  emptyText: 'No downloads yet.',
  columns: [
    { label: 'Title', render: d => `<strong>${d.title}</strong>` },
    { label: 'Description', render: d => d.description || '' },
    { label: 'Status', render: d => pill(d.published ? 'Published' : 'Hidden', d.published ? 'green' : 'gray') },
  ],
  formFieldsHtml: data => `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-input" name="title" value="${esc(data.title)}" required></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="2">${esc(data.description)}</textarea></div>
    <div class="form-group"><label class="form-label">File URL *</label><input class="form-input" name="file_url" value="${esc(data.file_url)}" placeholder="https://media.victoriasugar.ug/docs/..." required></div>
    <div class="form-check"><input type="checkbox" id="dl-published" name="published" ${data.published !== false ? 'checked' : ''}><label class="form-label" for="dl-published">Published (visible on site)</label></div>
  `,
  buildPayload: fd => ({
    title: fd.get('title'), description: fd.get('description'),
    file_url: fd.get('file_url'), published: fd.get('published') === 'on',
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
      <div class="stat-card"><div class="stat-label">News Articles</div><div class="stat-value" id="stat-news">—</div></div>
      <div class="stat-card"><div class="stat-label">Open Tenders</div><div class="stat-value" id="stat-tenders">—</div></div>
      <div class="stat-card"><div class="stat-label">Inquiries</div><div class="stat-value" id="stat-inq">—</div></div>
      <div class="stat-card"><div class="stat-label">Subscribers</div><div class="stat-value" id="stat-subs">—</div></div>
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
      <a href="#" class="action-card" onclick="showPage('tenders');return false;"><div class="icon">📋</div><div class="label">Add Tender</div></a>
      <a href="#" class="action-card" onclick="showPage('gallery');return false;"><div class="icon">🖼️</div><div class="label">Upload Photo</div></a>
    </div>
  `;

  const now = new Date().toISOString();
  const [newsRes, tendersRes, inqRes, subsRes] = await Promise.all([
    dbAdmin.from('news_articles').select('id', { count: 'exact', head: true }).eq('published', true),
    dbAdmin.from('tenders').select('id', { count: 'exact', head: true }).gte('deadline', now),
    dbAdmin.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    dbAdmin.from('newsletter_subscribers').select('id', { count: 'exact', head: true }),
  ]);
  document.getElementById('stat-news').textContent = newsRes.count ?? '—';
  document.getElementById('stat-tenders').textContent = tendersRes.count ?? '—';
  document.getElementById('stat-inq').textContent = inqRes.count ?? '—';
  document.getElementById('stat-subs').textContent = subsRes.count ?? '—';

  const { data } = await dbAdmin.from('inquiries').select('*').order('created_at', { ascending: false }).limit(5);
  const box = document.getElementById('recent-inq');
  if (!data || !data.length) { box.innerHTML = '<p class="empty-state">No inquiries yet.</p>'; return; }
  box.innerHTML = '<table><thead><tr><th>Name</th><th>Subject</th><th>Date</th><th>Status</th></tr></thead><tbody>' +
    data.map(i => `<tr><td><strong>${i.name || ''}</strong></td><td>${i.subject || ''}</td><td style="font-size:.75rem;color:var(--gray-500);">${fmtDate(i.created_at)}</td><td>${pill(i.status || 'new', i.status === 'new' ? 'amber' : 'green')}</td></tr>`).join('') +
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
        <button class="btn btn-outline btn-sm" onclick="openAlbumModal()">+ Add Album</button>
        <button class="btn btn-primary btn-sm" onclick="openPhotoModal()">+ Add Photo</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:1.5rem;">
      <div class="card-title" style="margin-bottom:1rem;">Albums</div>
      <div id="albums-list" class="tab-bar"></div>
      <div style="font-size:.75rem;color:var(--gray-500);">Click an album to filter photos. Add photos with + Add Photo above.</div>
    </div>
    <div id="photos-grid" class="photo-grid"></div>
  `;

  let albums = [], filterAlbum = 'all';

  window.setGalleryFilter = function (id) { filterAlbum = id; loadAlbums(); };

  async function loadAlbums() {
    const { data: al } = await dbAdmin.from('gallery_albums').select('*').eq('active', true).order('created_at', { ascending: false });
    albums = al || [];
    const alEl = document.getElementById('albums-list');
    if (!alEl) return;
    alEl.innerHTML = `<button class="album-tab-btn ${filterAlbum === 'all' ? 'active-tab' : ''}" onclick="setGalleryFilter('all')">All</button>` +
      albums.map(a => `<button class="album-tab-btn ${filterAlbum === a.id ? 'active-tab' : ''}" onclick="setGalleryFilter('${a.id}')">${a.name}</button>`).join('');
    loadPhotos();
  }

  async function loadPhotos() {
    const grid = document.getElementById('photos-grid');
    if (!grid) return;
    let q = dbAdmin.from('gallery_items').select('id,image_url,caption,album_id').order('created_at', { ascending: false });
    if (filterAlbum !== 'all') q = q.eq('album_id', filterAlbum);
    const { data } = await q;
    if (!data || !data.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No photos yet. Click + Add Photo to upload.</div>'; return; }
    grid.innerHTML = data.map(p => `
      <div class="photo-tile">
        <img src="${p.image_url}">
        <div class="photo-overlay">
          <button class="photo-delete" onclick="deletePhoto('${p.id}')">Delete</button>
          ${p.caption ? `<div class="photo-caption">${p.caption}</div>` : ''}
        </div>
      </div>`).join('');
  }

  window.openAlbumModal = function () {
    showModal(`
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-title">Add Album</div>
      <form id="album-form">
        <div class="form-group"><label class="form-label">Album Name *</label><input class="form-input" name="name" required></div>
        <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="2"></textarea></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Create Album</button>
      </form>
    `);
    document.getElementById('album-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await dbAdmin.from('gallery_albums').insert([{ name: fd.get('name'), description: fd.get('description'), active: true }]);
      closeModal(); showToast('Album created'); loadAlbums();
    });
  };

  window.openPhotoModal = function () {
    showModal(`
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-title">Add Photo</div>
      <form id="photo-form">
        <div class="form-group"><label class="form-label">Image URL * (from R2)</label><input class="form-input" name="image_url" placeholder="https://media.victoriasugar.ug/images/..." required></div>
        <div class="form-group"><label class="form-label">Caption</label><input class="form-input" name="caption" placeholder="Optional caption"></div>
        <div class="form-group"><label class="form-label">Album</label><select class="form-input" name="album_id"><option value="">No album</option>${albums.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></div>
        <div id="photo-preview" style="display:none;margin-bottom:1rem;"><img id="preview-img" style="width:100%;border-radius:.5rem;max-height:10rem;object-fit:cover;"></div>
        <div class="modal-error" id="photo-err"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Add Photo</button>
      </form>
    `);
    document.querySelector('#photo-form [name=image_url]').addEventListener('blur', e => {
      const url = e.target.value.trim();
      if (url) { document.getElementById('preview-img').src = url; document.getElementById('photo-preview').style.display = 'block'; }
    });
    document.getElementById('photo-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const err = document.getElementById('photo-err');
      const { error } = await dbAdmin.from('gallery_items').insert([{ image_url: fd.get('image_url'), caption: fd.get('caption') || null, album_id: fd.get('album_id') || null }]);
      if (error) { err.textContent = error.message; err.style.display = 'block'; return; }
      closeModal(); showToast('Photo added'); loadPhotos();
    });
  };

  window.deletePhoto = async function (id) {
    if (!confirm('Delete this photo?')) return;
    await dbAdmin.from('gallery_items').delete().eq('id', id);
    showToast('Deleted'); loadPhotos();
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
        <option value="all">All Statuses</option>
        <option value="new">New</option><option value="read">Read</option>
        <option value="replied">Replied</option><option value="closed">Closed</option>
      </select>
    </div>
    <div class="card" style="padding:0;overflow:auto;">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Subject</th><th>Date</th><th>Status</th><th></th></tr></thead>
        <tbody id="inq-body"><tr><td colspan="6" class="empty-state">Loading...</td></tr></tbody>
      </table>
    </div>
  `;

  let currentId = null;

  window.loadInquiries = async function () {
    const filter = document.getElementById('status-filter').value;
    let q = dbAdmin.from('inquiries').select('*').order('created_at', { ascending: false }).limit(50);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data } = await q;
    const tb = document.getElementById('inq-body');
    if (!tb) return;
    if (!data || !data.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-state">No inquiries found.</td></tr>'; return; }
    tb.innerHTML = data.map(i => `
      <tr style="cursor:pointer" onclick="viewInquiry('${i.id}')">
        <td><strong>${i.name || ''}</strong></td>
        <td>${i.email || ''}</td>
        <td>${i.subject || ''}</td>
        <td style="font-size:.75rem;color:var(--gray-500);">${fmtDate(i.created_at)}</td>
        <td>${pill(i.status || 'new', i.status === 'new' ? 'amber' : (i.status === 'replied' ? 'green' : 'gray'))}</td>
        <td style="text-align:right;color:var(--gray-300);">→</td>
      </tr>`).join('');
  };

  window.viewInquiry = async function (id) {
    currentId = id;
    const { data } = await dbAdmin.from('inquiries').select('*').eq('id', id).single();
    if (!data) return;
    showModal(`
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <div class="modal-title">Inquiry Detail</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:1.25rem;">
        ${[['Name', data.name], ['Email', `<a href="mailto:${data.email}" style="color:var(--green-600)">${data.email}</a>`], ['Phone', data.phone || '—'], ['Subject', data.subject || '—'], ['Date', data.created_at ? new Date(data.created_at).toLocaleString() : '']]
          .map(([k, v]) => `<tr style="border-bottom:1px solid var(--gray-100)"><td style="padding:.5rem 0;font-size:.875rem;color:var(--gray-500);width:35%;">${k}</td><td style="padding:.5rem 0;font-size:.875rem;font-weight:500;">${v}</td></tr>`).join('')}
      </table>
      <div style="font-size:.875rem;color:var(--gray-500);font-weight:500;margin-bottom:.5rem;">Message:</div>
      <div style="background:var(--gray-50);border-radius:.5rem;padding:1rem;font-size:.875rem;color:var(--gray-700);line-height:1.7;margin-bottom:1.5rem;">${data.message || ''}</div>
      <div class="modal-actions">
        <button class="btn btn-primary btn-sm" onclick="markInquiryStatus('replied')">Mark Replied</button>
        <button class="btn btn-outline btn-sm" onclick="markInquiryStatus('read')">Mark Read</button>
        <button class="btn btn-danger btn-sm" onclick="markInquiryStatus('closed')">Close</button>
      </div>
    `);
    if (data.status === 'new') await dbAdmin.from('inquiries').update({ status: 'read' }).eq('id', id);
  };

  window.markInquiryStatus = async function (status) {
    if (!currentId) return;
    await dbAdmin.from('inquiries').update({ status }).eq('id', currentId);
    closeModal(); showToast('Status updated'); loadInquiries();
  };

  document.getElementById('status-filter').addEventListener('change', loadInquiries);
  loadInquiries();
}

// ══════════════════════════════════════
//  PAGE: NEWSLETTER
// ══════════════════════════════════════

async function renderNewsletter(el) {
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-title">Newsletter Subscribers</div>
      <div id="sub-count" class="pill green" style="font-size:.8125rem;padding:.5rem 1rem;"></div>
    </div>
    <div class="card" style="padding:0;overflow:auto;">
      <table><thead><tr><th>Email</th><th>Subscribed</th><th></th></tr></thead><tbody id="nl-body"></tbody></table>
    </div>
  `;

  window.loadSubscribers = async function () {
    const { data, count } = await dbAdmin.from('newsletter_subscribers').select('*', { count: 'exact' }).order('subscribed_at', { ascending: false });
    document.getElementById('sub-count').textContent = (count || 0) + ' subscribers';
    const tb = document.getElementById('nl-body');
    if (!data || !data.length) { tb.innerHTML = '<tr><td colspan="3" class="empty-state">No subscribers yet.</td></tr>'; return; }
    tb.innerHTML = data.map(s => `
      <tr><td>${s.email}</td><td style="font-size:.75rem;color:var(--gray-500);">${fmtDate(s.subscribed_at)}</td>
      <td style="text-align:right;"><button class="btn-link" style="color:var(--red-500);" onclick="removeSubscriber('${s.id}','${(s.email || '').replace(/'/g, '')}')">Remove</button></td></tr>`).join('');
  };

  window.removeSubscriber = async function (id, email) {
    if (!confirm('Remove ' + email + ' from the newsletter?')) return;
    await dbAdmin.from('newsletter_subscribers').delete().eq('id', id);
    showToast('Removed'); loadSubscribers();
  };

  loadSubscribers();
}

// ══════════════════════════════════════
//  PAGE: SETTINGS
// ══════════════════════════════════════

async function renderSettings(el) {
  el.innerHTML = `
    <div class="page-header"><div class="page-header-title">Settings</div></div>
    <div class="grid-2">
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
      <div class="card">
        <div class="card-title" style="margin-bottom:1rem;">Account Info</div>
        <div id="acct-info" style="color:var(--gray-500);font-size:.875rem;line-height:1.8;"></div>
        <div style="margin-top:1.5rem;">
          <div style="font-weight:600;color:var(--gray-700);margin-bottom:.5rem;font-size:.875rem;">Quick Links</div>
          <a href="/" target="_blank" style="display:block;color:var(--green-600);text-decoration:none;font-size:.875rem;margin-bottom:.4rem;">→ View Website</a>
          <a href="https://ffsddbbtgoxbqlrnvcrm.supabase.co" target="_blank" style="display:block;color:var(--green-600);text-decoration:none;font-size:.875rem;margin-bottom:.4rem;">→ Supabase Dashboard</a>
          <a href="https://dash.cloudflare.com" target="_blank" style="display:block;color:var(--green-600);text-decoration:none;font-size:.875rem;">→ Cloudflare Dashboard</a>
        </div>
      </div>
    </div>
  `;

  const { data: { user } } = await db.auth.getUser();
  if (user) document.getElementById('acct-info').innerHTML =
    `<strong>Email:</strong> ${user.email}<br><strong>Role:</strong> Admin<br><strong>Last Sign In:</strong> ${user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '—'}`;

  document.getElementById('pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('pw-msg');
    const fd = new FormData(e.target);
    if (fd.get('new') !== fd.get('confirm')) { msg.style.color = 'var(--red-500)'; msg.textContent = 'Passwords do not match.'; msg.style.display = 'block'; return; }
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
  checkAuth().then(session => {
    if (!session) return;
    document.getElementById('admin-user').textContent = session.user.email;
    showPage('dashboard');
  });
});
