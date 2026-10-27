/* ReliefLink India — plain JavaScript frontend. No React or TypeScript. */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const CATEGORIES = ['Food', 'Water', 'Shelter', 'Clothing', 'Hygiene', 'Medical essentials'];
const INCIDENT_TYPES = ['Flood', 'Cyclone', 'Landslide', 'Earthquake', 'Fire', 'Storm', 'Heatwave', 'Other'];
const ROLES = ['Administrator', 'NGO partner', 'Shelter manager', 'Donor', 'Volunteer', 'Person in need'];
const EMPTY_STATE = { incidents: [], needs: [], offers: [], pledges: [], beneficiaryRequests: [], ngoProfiles: [], userProfiles: [], updatedAt: null };
const COLLECTIONS = Object.keys(EMPTY_STATE).filter(key => key !== 'updatedAt');
let state = structuredClone(EMPTY_STATE);
let lastSyncedState = structuredClone(EMPTY_STATE);
let officialSources = [];
let currentUser = null;
let isCreatingAccount = false;
let currentPage = 'overview';
let currentMap = null;
let refreshTimer = null;
let savingState = false;
let stateDirty = false;
let toastTimer;
let modalSubmitHandler = null;

function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function esc(value = '') { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function fmtDate(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtDateTime(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function statusClass(status = '') { const s = status.toLowerCase(); if (s.includes('verif') || s.includes('approved') || s.includes('received') || s.includes('fulfilled')) return 'verified'; if (s.includes('reject') || s.includes('critical')) return 'rejected'; if (s.includes('pending')) return 'pending'; if (s.includes('available')) return 'available'; if (s.includes('matched')) return 'matched'; if (s.includes('open')) return 'open'; return ''; }
function badge(status) { return `<span class="status ${statusClass(status)}">${esc(status || 'Unknown')}</span>`; }
function showToast(message, error = false) { const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
function hasAdmin() { return currentUser?.role === 'Administrator'; }
function canManageNeeds() { return ['Administrator', 'NGO partner', 'Shelter manager'].includes(currentUser?.role); }
function isNgo() { return ['NGO partner', 'Shelter manager'].includes(currentUser?.role); }
function updateLoginIdentityRequirement() {
  const isAdministrator = $('#userRole').value === 'Administrator';
  $('#adminCodeField').hidden = !isCreatingAccount || !isAdministrator;
  $('#adminSignupCode').required = isCreatingAccount && isAdministrator;
}
function setAccountMode(createAccount) {
  isCreatingAccount = createAccount;
  $('#nameField').hidden = !createAccount;
  $('#roleField').hidden = !createAccount;
  $('#verificationField').hidden = !createAccount;
  $('#confirmPasswordField').hidden = !createAccount;
  $('#userName').required = createAccount;
  $('#verificationId').required = createAccount;
  $('#confirmPassword').required = createAccount;
  $('#userPassword').autocomplete = createAccount ? 'new-password' : 'current-password';
  $('#passwordRequirement').textContent = createAccount ? '12+ characters' : 'Required';
  $('#loginEyebrow').textContent = createAccount ? 'JOIN RELIEFLINK INDIA' : 'WELCOME BACK';
  $('#loginTitle').textContent = createAccount ? 'Create your ReliefLink account' : 'Sign in to your workspace';
  $('#loginDescription').textContent = createAccount
    ? 'Create an account with your email and a password. Verified public incidents and resource needs are shared; personal records are filtered by role.'
    : 'Sign in with the email address and password you used to create your account.';
  $('#loginSubmitLabel').textContent = createAccount ? 'Create account' : 'Sign in';
  $('#accountModePrompt').textContent = createAccount ? 'Already have a profile?' : 'New to ReliefLink India?';
  $('#accountModeToggle').textContent = createAccount ? 'Sign in' : 'Create account';
  $('#accountModeToggle').setAttribute('aria-label', createAccount ? 'Sign in to an existing profile' : 'Create a new account');
  $('#userPassword').value = '';
  $('#confirmPassword').value = '';
  $('#adminSignupCode').value = '';
  updateLoginIdentityRequirement();
}
function profileIdForUser(user) { return `${user.role.toLowerCase()}:${user.email}`; }
async function enterWorkspace(user) {
  currentUser = user;
  if (!await loadState()) { currentUser = null; return false; }
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#headerName').textContent = currentUser.name;
  $('#headerRole').textContent = currentUser.role;
  $('#avatar').textContent = (currentUser.name || 'A').slice(0, 1).toUpperCase();
  renderPage('overview');
  updateCounts();
  startLiveRefresh();
  return true;
}
function escapeCSV(value) { const s = String(value ?? ''); return `"${s.replaceAll('"', '""')}"`; }
function downloadFile(name, contents, type = 'application/json') { const blob = new Blob([contents], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function safeHttpUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function mapsSearchUrl(value) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`; }

async function loadState() {
  try {
    const [res, sourceResponse, healthResponse] = await Promise.all([fetch('/api/state'), fetch('/api/sources'), fetch('/api/health')]);
    if (!res.ok) throw new Error(`Workspace API returned ${res.status}.`);
    if (!sourceResponse.ok) throw new Error(`Source catalog API returned ${sourceResponse.status}.`);
    if (!healthResponse.ok) throw new Error(`Database health API returned ${healthResponse.status}.`);
    const incoming = await res.json();
    const sourceData = await sourceResponse.json();
    const health = await healthResponse.json();
    state = { ...structuredClone(EMPTY_STATE), ...incoming };
    lastSyncedState = structuredClone(state);
    stateDirty = false;
    officialSources = sourceData.sources;
    $('#databaseStatus').textContent = 'Live MongoDB sync';
  } catch (e) {
    console.error(e);
    showToast('Could not load shared dashboard data. Check that the Node.js server is running, then try signing up again.', true);
    return false;
  }
  return true;
}
async function saveState() {
  if (savingState) return false;
  savingState = true;
  stateDirty = true;
  try {
    const changes = {};
    for (const key of COLLECTIONS) {
      const previous = lastSyncedState[key];
      const current = state[key];
      const previousById = new Map(previous.map(record => [String(record.id), record]));
      const currentById = new Map(current.map(record => [String(record.id), record]));
      const upsert = current.filter(record => JSON.stringify(previousById.get(String(record.id))) !== JSON.stringify(record));
      const deleted = previous.filter(record => !currentById.has(String(record.id))).map(record => String(record.id));
      if (upsert.length || deleted.length) changes[key] = { upsert, delete: deleted, order: current.map(record => String(record.id)) };
    }
    if (!Object.keys(changes).length) { stateDirty = false; return true; }
    const res = await fetch('/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Save failed'); }
    state = { ...structuredClone(EMPTY_STATE), ...(await res.json()) };
    lastSyncedState = structuredClone(state);
    stateDirty = false;
    return true;
  } catch (error) { console.error(error); showToast(error.message || 'Could not save data.', true); return false; }
  finally { savingState = false; }
}

async function refreshWorkspace() {
  if (!currentUser || savingState || stateDirty || $('#modal').open || document.visibilityState !== 'visible') return;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not refresh shared requests.');
    const incoming = { ...structuredClone(EMPTY_STATE), ...(await response.json()) };
    if (incoming.updatedAt === state.updatedAt) return;
    const oldNeedIds = new Set(state.needs.map(item => String(item.id)));
    const newNeeds = incoming.needs.filter(item => !oldNeedIds.has(String(item.id)));
    state = incoming;
    lastSyncedState = structuredClone(state);
    updateCounts();
    renderPage(currentPage);
    if (hasAdmin() && newNeeds.length) showToast(`${newNeeds.length} new resource request${newNeeds.length === 1 ? '' : 's'} received.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Could not refresh shared requests.', true);
  }
}
function startLiveRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshWorkspace, 5000);
}
function ownerMatches(value) {
  const owner = String(value || '').trim().toLowerCase();
  return Boolean(owner && [currentUser?.email, currentUser?.name].some(identity => String(identity || '').trim().toLowerCase() === owner));
}

// Role-specific workspace views. Records remain shared for relief coordination, but each role sees only the pages and records needed for its work.
const ROLE_PAGES = {
  'Administrator': ['overview','profile','incidents','needs','offers','pledges','map','people','verification','data'],
  'NGO partner': ['overview','profile','incidents','needs','pledges','map','verification'],
  'Shelter manager': ['overview','profile','incidents','needs','pledges','map','people','verification'],
  'Donor': ['overview','profile','needs','offers','pledges','map','verification'],
  'Volunteer': ['overview','profile','incidents','needs','map','verification'],
  'Person in need': ['overview','profile','people','verification']
};
function canOpenPage(page) { return (ROLE_PAGES[currentUser?.role] || ['overview','profile']).includes(page); }
function ownRecord(record) { return ownerMatches(record?.ownerId || record?.donorEmail || record?.email); }
function visibleIncidents() {
  if (hasAdmin()) return state.incidents;
  if (isNgo()) return state.incidents.filter(item => item.status === 'Verified' || ownerMatches(item.ownerId) || item.submittedBy === currentUser.name);
  if (currentUser?.role === 'Volunteer' || currentUser?.role === 'Donor') return state.incidents.filter(item => item.status === 'Verified');
  return [];
}
function visibleNeeds() {
  if (hasAdmin()) return state.needs;
  if (isNgo()) return state.needs.filter(item => ownerMatches(item.ownerId) || (item.verificationStatus === 'Verified' && !['Closed','Fulfilled'].includes(item.status)));
  if (['Donor','Volunteer'].includes(currentUser?.role)) return state.needs.filter(item => item.verificationStatus === 'Verified' && !['Closed','Fulfilled'].includes(item.status));
  return [];
}
function visibleOffers() {
  if (hasAdmin()) return state.offers;
  if (currentUser?.role === 'Donor') return state.offers.filter(ownRecord);
  if (isNgo()) return state.offers.filter(item => item.status !== 'Withdrawn');
  return [];
}
function visiblePledges() {
  if (hasAdmin()) return state.pledges;
  if (currentUser?.role === 'Donor') return state.pledges.filter(item => ownerMatches(item.donorEmail) || item.donor === currentUser.name);
  if (isNgo()) {
    const ids = new Set(state.needs.filter(item => ownerMatches(item.ownerId)).map(item => item.id));
    return state.pledges.filter(item => ids.has(item.needId));
  }
  return [];
}
function visiblePeopleRequests() {
  if (hasAdmin()) return state.beneficiaryRequests;
  if (currentUser?.role === 'Person in need') return state.beneficiaryRequests.filter(item => ownerMatches(item.ownerId));
  if (currentUser?.role === 'Shelter manager') return state.beneficiaryRequests.filter(item => item.status === 'Approved' || item.status === 'Fulfilled');
  return [];
}
function canViewIncidentEvidence(item) { return hasAdmin() || (isNgo() && ownerMatches(item?.ownerId)); }
function canViewNeedEvidence(item) { return hasAdmin() || (isNgo() && ownerMatches(item?.ownerId)); }
function applyRoleNavigation() {
  const allowed = new Set(ROLE_PAGES[currentUser?.role] || ['overview','profile']);
  $$('.nav-item[data-page]').forEach(button => { button.hidden = !allowed.has(button.dataset.page); });
  $$('.workspace-label, .nav-divider').forEach(el => { el.hidden = true; });
  const firstLabel = $('.sidebar .workspace-label');
  if (firstLabel) firstLabel.hidden = false;
  const adminLabel = $$('.sidebar .workspace-label').find(el => el.textContent.trim() === 'ADMINISTRATION');
  if (adminLabel) adminLabel.hidden = currentUser?.role !== 'Administrator';
  const divider = $('.nav-divider'); if (divider) divider.hidden = currentUser?.role !== 'Administrator';
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const credentials = {
    email: $('#userEmail').value.trim().toLowerCase(),
    password: $('#userPassword').value
  };
  if (isCreatingAccount) {
    if ($('#userPassword').value !== $('#confirmPassword').value) return showToast('Passwords do not match.', true);
    Object.assign(credentials, {
      name: $('#userName').value.trim(),
      role: $('#userRole').value,
      verificationId: $('#verificationId').value.trim(),
      adminSignupCode: $('#adminSignupCode').value
    });
  }
  try {
    const response = await fetch(isCreatingAccount ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Authentication failed.');
    $('#userPassword').value = '';
    $('#confirmPassword').value = '';
    await enterWorkspace(result.user);
  } catch (error) {
    console.error('Authentication request failed:', error);
    showToast(error.message || 'Could not authenticate your account.', true);
  }
});
async function logout() {
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not sign out from the server.');
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
    return;
  }
  currentUser = null;
  clearInterval(refreshTimer);
  refreshTimer = null;
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  setAccountMode(false);
  if (currentMap) { currentMap.remove(); currentMap = null; }
}
$('#logoutBtn').addEventListener('click', logout); $('#topLogout').addEventListener('click', logout);
$('#topProfile').addEventListener('click', () => renderPage('profile'));
$('#userRole').addEventListener('change', updateLoginIdentityRequirement);
$('#accountModeToggle').addEventListener('click', () => setAccountMode(!isCreatingAccount));
setAccountMode(false);
updateLoginIdentityRequirement();
$('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#navigation').addEventListener('click', event => { const btn = event.target.closest('[data-page]'); if (!btn) return; renderPage(btn.dataset.page); $('#sidebar').classList.remove('open'); });
$('#modalClose').addEventListener('click', closeModal); $('#modalCancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) closeModal(); });
$('#modalForm').addEventListener('submit', async event => { event.preventDefault(); if (!modalSubmitHandler) return; const formData = new FormData(event.currentTarget); const values = Object.fromEntries(formData.entries()); const file = formData.get('evidence'); if (file instanceof File && file.size > 0) { if (file.size > 1024 * 1024) return showToast('Please use an evidence file smaller than 1 MB for this prototype.', true); values.evidenceName = file.name; values.evidenceType = file.type || 'application/octet-stream'; values.evidenceDataUrl = await fileToDataURL(file); } try { await modalSubmitHandler(values); closeModal(); } catch (error) { showToast(error.message || 'Could not submit the form.', true); } });
function closeModal() { $('#modal').close(); modalSubmitHandler = null; $('#modalFields').innerHTML = ''; }
function openModal({ title, eyebrow = 'NEW RECORD', submit = 'Submit', fields, onSubmit }) { $('#modalTitle').textContent = title; $('#modalEyebrow').textContent = eyebrow; $('#modalSubmit').textContent = submit; $('#modalFields').innerHTML = fields.map(fieldHTML).join(''); modalSubmitHandler = onSubmit; $('#modal').showModal(); }
function fieldHTML(f) { const cls = `field${f.full ? ' full' : ''}`; let control = '';
  if (f.type === 'select') control = `<select name="${esc(f.name)}" ${f.required === false ? '' : 'required'}>${f.options.map(opt => { const val = typeof opt === 'string' ? opt : opt.value; const label = typeof opt === 'string' ? opt : opt.label; return `<option value="${esc(val)}" ${f.value === val ? 'selected' : ''}>${esc(label)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') control = `<textarea name="${esc(f.name)}" placeholder="${esc(f.placeholder || '')}" ${f.required === false ? '' : 'required'} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>${esc(f.value || '')}</textarea>`;
  else if (f.type === 'file') control = `<input name="evidence" type="file" accept="${esc(f.accept || '.pdf,.png,.jpg,.jpeg,.webp,.txt') }" ${f.required === false ? '' : 'required'}><small>${esc(f.help || 'Use a relevant file you have permission to share. Maximum 1 MB.')}</small>`;
  else control = `<input name="${esc(f.name)}" type="${esc(f.type || 'text')}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.required === false ? '' : 'required'} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>`;
  return `<div class="${cls}"><label>${esc(f.label)}${f.required === false ? ' (optional)' : ''}</label>${control}${f.note ? `<small>${esc(f.note)}</small>` : ''}</div>`;
}
async function fileToDataURL(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Could not read the evidence file.')); reader.readAsDataURL(file); }); }

function updateCounts() { $('#pendingIncidents').textContent = state.incidents.filter(x => x.status === 'Pending review').length; $('#pendingNeeds').textContent = state.needs.filter(x => x.verificationStatus === 'Pending review').length; }
function setNav(page, title) { currentPage = page; $('#currentCrumb').textContent = title; $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page)); }
function pageHeader(eyebrow, title, desc, actions = '') { return `<div class="page-heading"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p>${desc}</p></div><div class="heading-actions">${actions}</div></div>`; }
function statCard(label, value, icon, foot) { return `<article class="stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`; }
function emptyState(title, desc, icon = '◇') { return `<div class="empty-state"><div class="empty-icon">${icon}</div><b>${esc(title)}</b><p>${esc(desc)}</p></div>`; }
function tableEmpty(cols, msg = 'No records yet. Add a record to get started.') { return `<tr><td colspan="${cols}" class="table-empty">${esc(msg)}</td></tr>`; }
function canReviewIncident(incident) { return hasAdmin() && incident.status === 'Pending review'; }
function canReviewNeed(need) { return hasAdmin() && need.verificationStatus === 'Pending review'; }
function eligibleNeeds() { return state.needs.filter(n => n.verificationStatus === 'Verified' && n.status !== 'Closed' && n.status !== 'Fulfilled'); }
function renderPage(page) {
  const titles = { overview: hasAdmin() ? 'Admin dashboard' : isNgo() ? 'NGO dashboard' : 'Overview', profile: hasAdmin() ? 'Admin profile' : isNgo() ? 'NGO profile' : 'My profile', incidents: 'Disaster reports', needs: 'Resource requests', offers: 'Donor offers', pledges: 'Pledges & deliveries', map: 'Needs map', people: 'Individual requests', verification: 'Proof & verification', data: 'Data import / export' };
  if (!titles[page] || !canOpenPage(page)) page = 'overview'; setNav(page, titles[page]);
  applyRoleNavigation();
  if (page === 'overview') $('.nav-item[data-page="overview"]').innerHTML = `<span>▦</span>${esc(titles.overview)}`;
  if (currentMap) { currentMap.remove(); currentMap = null; }
  const root = $('#pageContent');
  const pages = { overview: hasAdmin() ? renderAdminDashboard : isNgo() ? renderNgoDashboard : currentUser?.role === 'Donor' ? renderDonorDashboard : currentUser?.role === 'Volunteer' ? renderVolunteerDashboard : currentUser?.role === 'Person in need' ? renderBeneficiaryDashboard : renderOverview, profile: renderProfile, incidents: renderIncidents, needs: renderNeeds, offers: renderOffers, pledges: renderPledges, map: renderMap, people: renderPeople, verification: renderVerificationPortal, data: renderDataTools };
  root.innerHTML = pages[page]();
  if (page === 'map') initMap();
  if (page === 'incidents') bindIncidentFilters();
  if (page === 'needs') bindNeedFilters();
  if (page === 'offers') bindOfferFilters();
  if (page === 'people') bindPeopleFilters();
}

function renderOverview() {
  const pendingI = state.incidents.filter(x => x.status === 'Pending review').length;
  const pendingN = state.needs.filter(x => x.verificationStatus === 'Pending review').length;
  const verifiedNeeds = eligibleNeeds().length;
  const availableOffers = state.offers.filter(x => ['Available', 'Matched'].includes(x.status)).length;
  const latest = [...state.incidents.map(x => ({ kind: 'Incident report', title: x.title, detail: `${x.location}, ${x.district}, ${x.state}`, date: x.reportedAt, status: x.status })), ...state.needs.map(x => ({ kind: 'Resource request', title: x.title, detail: `${x.shelter} · ${x.requestedQty} ${x.unit}`, date: x.updatedAt, status: x.verificationStatus || 'Demo / unverified' })), ...state.offers.map(x => ({ kind: 'Donor offer', title: x.item, detail: `${x.quantity} ${x.unit} · ${x.district}, ${x.state}`, date: x.createdAt, status: x.status }))].sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 5);
  const actions = `<button class="btn btn-outline" data-action="new-incident">＋ Report disaster</button><button class="btn btn-primary" data-action="new-need">＋ Request resources</button>`;
  return `${pageHeader('RELIEF OPERATIONS', 'Overview', 'A clear view of verified incidents, community needs and available assistance.', actions)}
    <div class="stats-grid">${statCard('Incidents awaiting review', pendingI, '⌁', '<strong>Manual review</strong> required')}${statCard('Needs awaiting review', pendingN, '♡', '<strong>Separate proof</strong> required')}${statCard('Verified open needs', verifiedNeeds, '✓', 'Eligible for matching')}${statCard('Available donor offers', availableOffers, '♧', 'Supplies offered')}</div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h3>Recent activity</h3><p>Latest records across the workspace</p></div><button class="text-link" data-page="incidents">View reports →</button></div><div class="panel-body"><div class="activity-list">${latest.length ? latest.map(item => `<div class="activity-item"><span class="activity-dot">${item.kind === 'Incident report' ? '⌁' : item.kind === 'Donor offer' ? '♧' : '♡'}</span><div><b>${esc(item.title)} <span class="subtext">· ${esc(item.kind)}</span></b><p>${esc(item.detail)}<br>${badge(item.status)}</p></div><time>${fmtDate(item.date)}</time></div>`).join('') : emptyState('No activity yet', 'Report a disaster, add a verified need or publish a donor offer to begin.')}</div></div></section>
    <section class="panel"><div class="panel-head"><div><h3>Verification workflow</h3><p>Safety checks before resources move</p></div></div><div class="panel-body"><div class="workflow"><div class="workflow-step"><span class="step-number">1</span><div><b>Report the incident</b><p>Record where and when it happened, what happened, the known or suspected cause, and evidence.</p></div></div><div class="workflow-step"><span class="step-number">2</span><div><b>Verify the disaster</b><p>An administrator checks the report against evidence and trusted official sources.</p></div></div><div class="workflow-step"><span class="step-number">3</span><div><b>Verify the exact need</b><p>Each request needs its own evidence for item, quantity and location.</p></div></div><div class="workflow-step"><span class="step-number">4</span><div><b>Match, hand over, confirm</b><p>Donors offer supplies; accepted pledges are tracked through delivery.</p></div></div></div><div class="callout"><b>Evidence-first rule</b><br>Incident approval does not automatically approve every resource request. Never treat demo records as real verified emergencies.</div></div></section></div>
    <div class="section-grid" style="margin-top:18px"><section class="panel"><div class="panel-head"><div><h3>Needs by category</h3><p>Verified, open resource requests</p></div><button class="text-link" data-page="needs">Open requests →</button></div><div class="panel-body"><div class="chart-bars">${CATEGORIES.map(c => { const n = eligibleNeeds().filter(x => x.category === c).length; const max = Math.max(1, ...CATEGORIES.map(cat => eligibleNeeds().filter(x => x.category === cat).length)); return `<div class="bar-row"><span>${esc(c)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(n ? 7 : 0, n / max * 100)}%"></div></div><b>${n}</b></div>`; }).join('')}</div></div></section><section class="panel"><div class="panel-head"><div><h3>Quick actions</h3><p>Choose the next step for your role</p></div></div><div class="panel-body"><div class="tool-actions" style="margin-top:0"><button class="btn btn-outline" data-action="new-incident">＋ Report a disaster</button><button class="btn btn-outline" data-action="new-need">＋ Add a resource need</button><button class="btn btn-outline" data-action="new-offer">＋ Offer supplies</button><button class="btn btn-outline" data-page="data">⇧ Import / export</button></div><p class="muted" style="font-size:10px;line-height:1.6;margin:16px 0 0">The demo role selector is not identity verification. Production use requires secure accounts, server-side permissions and a real database.</p></div></section></div>`;
}

function renderAdminDashboard() {
  const pendingIncidents = state.incidents.filter(item => item.status === 'Pending review');
  const pendingNeeds = state.needs.filter(item => item.verificationStatus === 'Pending review');
  const latestNeeds = [...state.needs].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 5);
  const pendingPeople = state.beneficiaryRequests.filter(item => item.status === 'Pending review');
  const deliveries = state.pledges.filter(item => ['Accepted', 'In transit', 'Partially received'].includes(item.status)).length;
  const queue = (items, kind) => items.length ? items.map(item => {
    const isIncident = kind === 'incident';
    const title = isIncident ? item.title : kind === 'need' ? item.title : item.item;
    const place = isIncident ? `${item.location}, ${item.district}, ${item.state}` : `${item.district}, ${item.state}`;
    const actions = isIncident
      ? `<button class="btn btn-primary btn-small" data-action="review-incident" data-id="${esc(item.id)}" data-status="Verified">Verify</button><button class="btn btn-danger btn-small" data-action="review-incident" data-id="${esc(item.id)}" data-status="Rejected">Reject</button>`
      : kind === 'need'
        ? `<button class="btn btn-primary btn-small" data-action="review-need" data-id="${esc(item.id)}" data-status="Verified">Verify</button><button class="btn btn-danger btn-small" data-action="review-need" data-id="${esc(item.id)}" data-status="Rejected">Reject</button>`
        : `<button class="btn btn-primary btn-small" data-action="review-person" data-id="${esc(item.id)}" data-status="Approved">Approve</button><button class="btn btn-danger btn-small" data-action="review-person" data-id="${esc(item.id)}" data-status="Rejected">Reject</button>`;
    return `<div class="queue-item"><div><b>${esc(title)}</b><p>${esc(place)} · ${fmtDate(item.reportedAt || item.createdAt)}</p></div><div class="action-group">${actions}</div></div>`;
  }).join('') : emptyState('Queue clear', 'No records are waiting for review.');
  const panel = (title, items, kind, page) => `<section class="panel"><div class="panel-head"><div><h3>${title}</h3><p>${items.length} awaiting review</p></div><button class="text-link" data-page="${page}">Open queue →</button></div><div class="panel-body"><div class="review-queue">${queue(items, kind)}</div></div></section>`;
  const incomingRows = latestNeeds.length ? latestNeeds.map(item => `<div class="queue-item"><div><b>${esc(item.title)} · ${esc(item.item || item.category)}</b><p>${esc(item.shelter || item.organisation || 'Organisation')} · ${esc(item.district)}, ${esc(item.state)} · ${fmtDateTime(item.updatedAt)}</p></div><div class="action-group">${badge(item.verificationStatus || 'Pending review')}<button class="btn btn-outline btn-small" data-page="needs">Open request</button></div></div>`).join('') : emptyState('No requests saved yet', 'Requests appear after an NGO submits them in this app. Government and NGO reference portals are not automatically imported.');
  return `${pageHeader('ADMINISTRATION', 'Admin dashboard', 'Review evidence and coordinate safe, accountable relief across the workspace.', `<button class="btn btn-outline" data-page="incidents">All incidents</button><button class="btn btn-primary" data-page="needs">All resource needs</button>`)}
    <div class="stats-grid">${statCard('Incidents to review', pendingIncidents.length, '⌁', 'Verify evidence before approval')}${statCard('Needs to review', pendingNeeds.length, '♡', 'Review each exact request')}${statCard('People requests', pendingPeople.length, '♙', 'Pending assistance reviews')}${statCard('Active deliveries', deliveries, '⇄', 'Accepted or in transit')}</div>
    <section class="panel incoming-panel"><div class="panel-head"><div><h3>Incoming NGO / shelter requests</h3><p>${state.needs.length} requests saved in the shared database · syncs every 5 seconds</p></div><button class="text-link" data-page="needs">View all →</button></div><div class="panel-body"><div class="review-queue">${incomingRows}</div></div></section>
    <div class="section-grid admin-queues">${panel('Incident review', pendingIncidents, 'incident', 'incidents')}${panel('Resource need review', pendingNeeds, 'need', 'needs')}${panel('Individual assistance', pendingPeople, 'person', 'people')}</div>
    <div class="verification-banner"><span>✓</span><div><b>Review evidence before changing status</b><p>Verifying an incident does not verify related needs. Confirm the linked incident and separate request evidence independently.</p></div></div>`;
}

function renderNgoDashboard() {
  const ownNeeds = state.needs.filter(item => ownerMatches(item.ownerId));
  const ownIncidents = state.incidents.filter(item => item.submittedBy === currentUser.name || ownerMatches(item.ownerId));
  const ownNeedIds = new Set(ownNeeds.map(item => item.id));
  const ownPledges = state.pledges.filter(item => ownNeedIds.has(item.needId));
  const delivered = ownPledges.filter(item => item.status === 'Received').length;
  const rows = ownNeeds.length ? ownNeeds.map(item => `<tr><td><strong>${esc(item.title)}</strong><span class="subtext">${esc(item.shelter || item.organisation || '')} · ${esc(item.category)}</span></td><td>${esc(item.district)}, ${esc(item.state)}</td><td>${Number(item.pledgedQty || 0)} / ${Number(item.requestedQty)} ${esc(item.unit)}</td><td>${Number(item.receivedQty || 0)} ${esc(item.unit)}</td><td>${badge(item.verificationStatus || 'Pending review')}</td><td>${badge(item.status || 'Open')}</td></tr>`).join('') : tableEmpty(6, 'No requests match this account yet. Submit using this account email and select a verified incident.');
  const deliveryRows = ownPledges.length ? ownPledges.map(pledge => { const need = ownNeeds.find(item => item.id === pledge.needId); return `<tr><td><strong>${esc(need?.title || 'Resource request')}</strong><span class="subtext">${esc(need?.item || '')}</span></td><td>${esc(pledge.donor || 'Donor')}</td><td>${Number(pledge.receivedQty || (pledge.status === 'Received' ? pledge.quantity : 0))} / ${Number(pledge.quantity)} ${esc(need?.unit || 'items')}</td><td>${badge(pledge.status)}</td><td>${fmtDate(pledge.updatedAt || pledge.createdAt)}</td></tr>`; }).join('') : tableEmpty(5, 'Pledges and delivered supplies for your requests appear here.');
  return `${pageHeader('NGO OPERATIONS', 'NGO dashboard', 'Track your organisation’s submitted needs, verification progress and incoming deliveries.', `<button class="btn btn-outline" data-action="new-incident">＋ Report incident</button><button class="btn btn-primary" data-action="new-need">＋ Request resources</button>`)}
    <div class="stats-grid">${statCard('My resource requests', ownNeeds.length, '♡', 'Shared database records')}${statCard('Needs awaiting review', ownNeeds.filter(item => item.verificationStatus === 'Pending review').length, '◷', 'Administrator review')}${statCard('Linked pledges', ownPledges.length, '⇄', 'For your requests')}${statCard('Deliveries received', delivered, '✓', 'Confirmed handovers')}</div>
    <section class="panel incoming-panel"><div class="panel-head"><div><h3>My resource requests</h3><p>Live status · updated across workspaces every 5 seconds</p></div><button class="text-link" data-page="needs">Browse all requests →</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>REQUEST</th><th>LOCATION</th><th>PLEDGED / NEEDED</th><th>RECEIVED</th><th>VERIFICATION</th><th>STATUS</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h3>Incoming supplies</h3><p>${ownPledges.length} pledges linked to your requests</p></div><button class="text-link" data-page="pledges">View deliveries →</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>REQUEST</th><th>DONOR</th><th>RECEIVED / PLEDGED</th><th>DELIVERY</th><th>UPDATED</th></tr></thead><tbody>${deliveryRows}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><div><h3>My incident reports</h3><p>${ownIncidents.length} submitted by this account</p></div><button class="text-link" data-page="incidents">View reports →</button></div><div class="panel-body"><div class="activity-list">${ownIncidents.length ? ownIncidents.slice(0, 5).map(item => `<div class="activity-item"><span class="activity-dot">⌁</span><div><b>${esc(item.title)}</b><p>${esc(item.district)}, ${esc(item.state)}<br>${badge(item.status)}</p></div><time>${fmtDate(item.reportedAt)}</time></div>`).join('') : emptyState('No incident reports yet', 'Reports you submit will be listed here.')}</div></div></section></div>
    <div class="verification-banner"><span>ⓘ</span><div><b>Requests become eligible for matching only after verification</b><p>Link each request to a verified incident and submit separate evidence for the specific item, quantity and delivery location.</p></div></div>`;
}

function renderDonorDashboard() {
  const offers = visibleOffers(); const pledges = visiblePledges(); const needs = eligibleNeeds();
  return `${pageHeader('DONOR WORKSPACE','Donor dashboard','Browse verified open needs, publish your available supplies and track only your own pledges.', '<button class="btn btn-primary" data-action="new-offer">＋ Offer supplies</button>')}
  <div class="stats-grid">${statCard('Verified open needs',needs.length,'✓','Eligible for matching')}${statCard('My active offers',offers.filter(x=>['Available','Matched','Accepted'].includes(x.status)).length,'♧','Your published supplies')}${statCard('My pledges',pledges.length,'⇄','Your commitments')}${statCard('Deliveries received',pledges.filter(x=>x.status==='Received').length,'✓','Confirmed handovers')}</div>
  <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h3>Verified needs you can support</h3><p>Only administrator-verified requests are eligible.</p></div><button class="text-link" data-page="needs">Browse needs →</button></div><div class="panel-body">${needs.slice(0,5).map(n=>`<div class="queue-item"><div><b>${esc(n.title)}</b><p>${esc(n.shelter||'Community')} · ${esc(n.district)}, ${esc(n.state)} · ${Number(n.requestedQty)-Number(n.pledgedQty||0)} ${esc(n.unit)} remaining</p></div>${badge(n.priority||'Normal')}</div>`).join('') || emptyState('No verified needs available','Verified resource requests will appear here.')}</div></section><section class="panel"><div class="panel-head"><div><h3>My latest offers</h3><p>Offers submitted from this account.</p></div><button class="text-link" data-page="offers">My offers →</button></div><div class="panel-body">${offers.slice(0,5).map(o=>`<div class="queue-item"><div><b>${esc(o.item)}</b><p>${Number(o.quantity)} ${esc(o.unit)} · ${esc(o.district)}, ${esc(o.state)}</p></div>${badge(o.status)}</div>`).join('') || emptyState('No offers yet','Publish supplies you can safely provide.')}</div></section></div>`;
}
function renderVolunteerDashboard() {
  const incidents = visibleIncidents(); const needs = eligibleNeeds();
  return `${pageHeader('VOLUNTEER WORKSPACE','Volunteer dashboard','See verified public information and help coordinate safely. Delivery assignment and volunteer screening are not implemented yet.', '<button class="btn btn-outline" data-page="map">Open needs map</button>')}
  <div class="stats-grid">${statCard('Verified incidents',incidents.length,'⌁','Public verified reports')}${statCard('Open verified needs',needs.length,'♡','Eligible requests')}${statCard('Districts represented',new Set(needs.map(n=>n.district).filter(Boolean)).size,'⌖','From verified requests')}${statCard('Next step',0,'✓','Contact an authorised NGO')}</div>
  <div class="verification-banner"><span>ⓘ</span><div><b>Volunteer safety</b><p>Do not independently enter dangerous areas or collect identity documents. Coordinate with verified organisations and local authorities. This prototype does not assign volunteers to tasks.</p></div></div>
  <div class="section-grid"><section class="panel"><div class="panel-head"><div><h3>Verified incidents</h3><p>Administrator-reviewed reports only.</p></div><button class="text-link" data-page="incidents">View reports →</button></div><div class="panel-body">${incidents.slice(0,5).map(i=>`<div class="queue-item"><div><b>${esc(i.title)}</b><p>${esc(i.district)}, ${esc(i.state)} · ${fmtDate(i.reportedAt)}</p></div>${badge(i.status)}</div>`).join('')||emptyState('No verified incidents','Verified public reports will appear here.')}</div></section><section class="panel"><div class="panel-head"><div><h3>Verified resource needs</h3><p>Use these to coordinate with authorised NGOs.</p></div><button class="text-link" data-page="needs">View needs →</button></div><div class="panel-body">${needs.slice(0,5).map(n=>`<div class="queue-item"><div><b>${esc(n.title)}</b><p>${esc(n.district)}, ${esc(n.state)} · ${Number(n.requestedQty)-Number(n.receivedQty||0)} ${esc(n.unit)} remaining</p></div>${badge(n.priority||'Normal')}</div>`).join('')||emptyState('No verified needs','Verified open needs will appear here.')}</div></section></div>`;
}
function renderBeneficiaryDashboard() {
  const requests = visiblePeopleRequests();
  return `${pageHeader('PERSONAL ASSISTANCE','My assistance dashboard','Create a request for essential support and track only requests submitted from your account.', '<button class="btn btn-primary" data-action="new-person-request">＋ Request assistance</button>')}
  <div class="stats-grid">${statCard('My requests',requests.length,'♙','Submitted by this account')}${statCard('Pending review',requests.filter(x=>x.status==='Pending review').length,'◷','Awaiting review')}${statCard('Approved',requests.filter(x=>x.status==='Approved').length,'✓','Approved assistance')}${statCard('Fulfilled',requests.filter(x=>x.status==='Fulfilled').length,'♡','Marked as received')}</div>
  <section class="panel"><div class="panel-head"><div><h3>My assistance requests</h3><p>Only your own requests are shown.</p></div><button class="text-link" data-page="people">View all →</button></div><div class="panel-body">${requests.length?requests.map(r=>`<div class="queue-item"><div><b>${esc(r.item)}</b><p>${esc(r.area)}, ${esc(r.district)}, ${esc(r.state)} · ${Number(r.quantity)} ${esc(r.unit)}</p></div>${badge(r.status)}</div>`).join(''):emptyState('No requests submitted','Use Request assistance to describe the essentials you need. You do not need to provide an Aadhaar or PAN number in this demo.')}</div></section>
  <div class="verification-banner"><span>ⓘ</span><div><b>Privacy and emergency access</b><p>Share only necessary information. In a real deployment, people without identity documents must still have an alternative route to request urgent help.</p></div></div>`;
}

function renderProfile() {
  if (hasAdmin()) return renderAdminProfile();
  if (isNgo()) return renderNgoProfile();
  const accountProfile = state.userProfiles.find(profile => profile.id === profileIdForUser(currentUser));
  return `${pageHeader('ACCOUNT', 'My profile', 'Your ReliefLink demo account and workspace access.')}
    <section class="profile-hero"><span class="profile-avatar">${esc(currentUser.name.slice(0, 1).toUpperCase())}</span><div><span class="eyebrow">SIGNED IN AS</span><h2>${esc(currentUser.name)}</h2><p>${esc(currentUser.role)}</p></div></section>
    <section class="panel profile-details"><div class="panel-head"><div><h3>Account details</h3><p>Profile information saved to the shared workspace</p></div></div><div class="panel-body profile-detail-grid"><div><span>Name</span><b>${esc(currentUser.name)}</b></div><div><span>Email</span><b>${esc(currentUser.email || 'Not provided')}</b></div><div><span>Role</span><b>${esc(currentUser.role)}</b></div><div><span>Verification ID</span><b>${esc(accountProfile?.verificationId || currentUser.verificationId || 'Not provided')}</b></div><div><span>Verification status</span><b>Not verified</b></div></div></section>
    ${renderPersonalInfoPanel(accountProfile)}`;
}

function renderPersonalInfoPanel(profile) {
  const detail = (label, value) => `<div><span>${label}</span><b>${esc(value || 'Not provided')}</b></div>`;
  return `<section class="panel profile-details"><div class="panel-head"><div><h3>Personal information</h3><p>Optional contact and location details for relief coordination.</p></div><button class="btn btn-outline btn-small" data-action="edit-profile">Edit details</button></div><div class="panel-body profile-detail-grid">${detail('Phone number', profile?.phone)}${detail('City / area', profile?.area)}${detail('District', profile?.district)}${detail('State / Union Territory', profile?.state)}${detail('Organization / shelter', profile?.organizationName)}</div></section>`;
}

function openProfileEditor() {
  const profile = state.userProfiles.find(item => item.id === profileIdForUser(currentUser)) || {};
  openModal({
    title: 'Edit personal information',
    eyebrow: 'MY PROFILE',
    submit: 'Save profile',
    fields: [
      { name: 'phone', label: 'Phone number', type: 'tel', value: profile.phone || '', required: false, maxlength: 30 },
      { name: 'area', label: 'City / area', value: profile.area || '', required: false, maxlength: 100 },
      { name: 'district', label: 'District', value: profile.district || '', required: false, maxlength: 100 },
      { name: 'state', label: 'State / Union Territory', value: profile.state || '', required: false, maxlength: 100 },
      { name: 'organizationName', label: 'Organization / shelter name', value: profile.organizationName || '', required: false, maxlength: 140, full: true }
    ],
    onSubmit: async values => {
      const updatedAt = new Date().toISOString();
      const updatedProfile = {
        ...profile,
        id: profileIdForUser(currentUser),
        email: currentUser.email,
        name: currentUser.name,
        role: currentUser.role,
        verificationId: currentUser.verificationId,
        ngoProofId: isNgo() ? currentUser.verificationId : '',
        ...values,
        updatedAt
      };
      state.userProfiles = [...state.userProfiles.filter(item => item.id !== updatedProfile.id), updatedProfile];
      if (isNgo()) {
        const existingNgoProfile = state.ngoProfiles.find(item => item.email === currentUser.email) || {};
        state.ngoProfiles = [
          ...state.ngoProfiles.filter(item => item.email !== currentUser.email),
          { ...existingNgoProfile, ...updatedProfile, id: currentUser.email, ngoProofId: currentUser.verificationId }
        ];
      }
      if (!await saveState()) throw new Error('Profile changes were not saved. Please try again.');
      currentUser = { ...currentUser, ...values };
      renderPage('profile');
      showToast('Personal information saved.');
    }
  });
}

function renderAdminProfile() {
  const accountProfile = state.userProfiles.find(profile => profile.id === profileIdForUser(currentUser));
  const pendingIncidents = state.incidents.filter(item => item.status === 'Pending review').length;
  const pendingNeeds = state.needs.filter(item => item.verificationStatus === 'Pending review').length;
  const pendingPeople = state.beneficiaryRequests.filter(item => item.status === 'Pending review').length;
  return `${pageHeader('ADMINISTRATOR ACCOUNT', 'Admin profile', 'Administrator account details and workspace review responsibilities.', '<button class="btn btn-primary" data-page="overview">Open admin dashboard</button>')}
    <section class="profile-hero admin-profile-hero"><span class="profile-avatar">${esc(currentUser.name.slice(0, 1).toUpperCase())}</span><div><span class="eyebrow">ADMINISTRATOR</span><h2>${esc(currentUser.name)}</h2><p>Workspace review and coordination</p></div><span class="profile-role-badge">Admin workspace</span></section>
    <div class="stats-grid">${statCard('Incidents to review', pendingIncidents, '⌁', 'Evidence review queue')}${statCard('Needs to review', pendingNeeds, '♡', 'Separate need verification')}${statCard('People requests', pendingPeople, '♙', 'Assistance review queue')}${statCard('Total incidents', state.incidents.length, '▦', 'Shared workspace')}</div>
    <section class="panel profile-details"><div class="panel-head"><div><h3>Administrator profile</h3><p>Account identity and responsibilities</p></div></div><div class="panel-body profile-detail-grid"><div><span>Name</span><b>${esc(currentUser.name)}</b></div><div><span>Email</span><b>${esc(currentUser.email || 'Not provided')}</b></div><div><span>Role</span><b>Administrator</b></div><div><span>Verification ID</span><b>${esc(accountProfile?.verificationId || currentUser.verificationId || 'Not provided')}</b></div><div><span>Verification status</span><b>Not verified</b></div><div><span>Workspace access</span><b>Review and coordinate records</b></div></div></section>
    ${renderPersonalInfoPanel(accountProfile)}
    <section class="panel profile-responsibilities"><div class="panel-head"><div><h3>Admin actions</h3><p>Review each record and its evidence independently</p></div></div><div class="panel-body tool-actions"><button class="btn btn-outline" data-page="incidents">Review disaster reports</button><button class="btn btn-outline" data-page="needs">Review resource requests</button><button class="btn btn-outline" data-page="people">Review individual requests</button><button class="btn btn-outline" data-page="verification">Open proof & verification</button></div></section>`;
}

function renderNgoProfile() {
  const accountProfile = state.userProfiles.find(profile => profile.id === profileIdForUser(currentUser));
  const ngoProfile = accountProfile || state.ngoProfiles.find(profile => profile.email === currentUser.email);
  const ownNeeds = state.needs.filter(item => ownerMatches(item.ownerId));
  const ownNeedIds = new Set(ownNeeds.map(item => item.id));
  const ownPledges = state.pledges.filter(item => ownNeedIds.has(item.needId));
  const received = ownPledges.filter(item => item.status === 'Received').length;
  const ownIncidents = state.incidents.filter(item => item.submittedBy === currentUser.name || ownerMatches(item.ownerId));
  const roleTitle = currentUser.role === 'Shelter manager' ? 'Shelter profile' : 'NGO profile';
  return `${pageHeader('ORGANISATION ACCOUNT', roleTitle, 'Organisation account details and your team’s relief activity.', '<button class="btn btn-primary" data-page="overview">Open NGO dashboard</button>')}
    <section class="profile-hero ngo-profile-hero"><span class="profile-avatar">${esc(currentUser.name.slice(0, 1).toUpperCase())}</span><div><span class="eyebrow">${esc(currentUser.role.toUpperCase())}</span><h2>${esc(currentUser.name)}</h2><p>${esc(currentUser.email)}</p></div><span class="profile-role-badge">Organisation workspace</span></section>
    <div class="stats-grid">${statCard('My requests', ownNeeds.length, '♡', 'Submitted by this account')}${statCard('Linked pledges', ownPledges.length, '⇄', 'For your resource requests')}${statCard('Deliveries received', received, '✓', 'Confirmed handovers')}${statCard('Incident reports', ownIncidents.length, '⌁', 'Submitted by this account')}</div>
    <section class="panel profile-details"><div class="panel-head"><div><h3>Organisation profile</h3><p>Account identity used to match your submissions across sessions</p></div></div><div class="panel-body profile-detail-grid"><div><span>Account name</span><b>${esc(currentUser.name)}</b></div><div><span>Account email</span><b>${esc(currentUser.email)}</b></div><div><span>Role</span><b>${esc(currentUser.role)}</b></div><div><span>Verification ID</span><b>${esc(ngoProfile?.verificationId || ngoProfile?.ngoProofId || currentUser.verificationId || 'Not provided')}</b></div><div><span>Verification</span><b>Not verified</b></div></div></section>
    ${renderPersonalInfoPanel(ngoProfile)}
    <section class="panel profile-responsibilities"><div class="panel-head"><div><h3>Organisation workspace</h3><p>Track your requests and coordinate verified deliveries</p></div></div><div class="panel-body tool-actions"><button class="btn btn-outline" data-page="overview">View NGO dashboard</button><button class="btn btn-outline" data-page="needs">View resource requests</button><button class="btn btn-outline" data-page="pledges">View pledges & deliveries</button><button class="btn btn-outline" data-page="incidents">View incident reports</button></div></section>`;
}

function renderVerificationPortal() {
  const sourceCards = officialSources.map(source => `<article class="tool-card source-card"><div class="tool-icon">✓</div><span class="eyebrow">${esc(source.type)}</span><h3>${esc(source.name)}</h3><p>${esc(source.access)}</p><a class="btn btn-outline btn-small" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Open official portal ↗</a></article>`).join('');
  const pendingIncidents = state.incidents.filter(item => item.status === 'Pending review');
  const pendingNeeds = state.needs.filter(item => item.verificationStatus === 'Pending review');
  const reviewedProofs = [
    ...state.incidents.filter(item => ['Verified', 'Rejected'].includes(item.status)).map(item => ({ kind: 'Incident', title: item.title, status: item.status, reviewer: item.reviewedBy, reviewerId: item.reviewedByVerificationId, note: item.reviewerNote, date: item.reviewedAt, sourceUrl: item.sourceUrl })),
    ...state.needs.filter(item => ['Verified', 'Rejected'].includes(item.verificationStatus)).map(item => ({ kind: 'Resource need', title: item.title, status: item.verificationStatus, reviewer: item.reviewedBy, reviewerId: item.reviewedByVerificationId, note: item.verifierNote, date: item.verifiedAt, sourceUrl: item.sourceUrl }))
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const incidentQueue = pendingIncidents.length ? pendingIncidents.map(item => {
    const source = safeHttpUrl(item.sourceUrl);
    const location = [item.location, item.district, item.state].filter(Boolean).join(', ');
    return `<article class="proof-card"><div class="proof-card-head"><div><span class="eyebrow">INCIDENT · ${esc(item.type || 'Disaster')}</span><h3>${esc(item.title)}</h3><p>${esc(location)} · ${fmtDateTime(item.occurredAt)}</p></div>${badge(item.status)}</div><p>${esc(item.description || 'No incident description submitted.')}</p><div class="proof-actions">${item.evidenceDataUrl ? `<button class="btn btn-outline btn-small" data-action="view-evidence" data-id="${esc(item.id)}" data-kind="incident">Open uploaded proof</button>` : '<span class="subtext">No uploaded proof attached</span>'}${source ? `<a class="btn btn-outline btn-small" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Open submitted source ↗</a>` : ''}<a class="btn btn-outline btn-small" href="${mapsSearchUrl(location)}" target="_blank" rel="noopener noreferrer">Check location in Google Maps ↗</a>${hasAdmin() ? `<button class="btn btn-primary btn-small" data-action="review-incident" data-id="${esc(item.id)}" data-status="Verified">Mark verified</button><button class="btn btn-danger btn-small" data-action="review-incident" data-id="${esc(item.id)}" data-status="Rejected">Reject</button>` : ''}</div></article>`;
  }).join('') : emptyState('No incident proofs awaiting review', 'Newly submitted disaster reports will appear here.');
  const needQueue = pendingNeeds.length ? pendingNeeds.map(item => {
    const incident = state.incidents.find(record => record.id === item.incidentId);
    const source = safeHttpUrl(item.sourceUrl);
    const location = [item.location, item.district, item.state].filter(Boolean).join(', ');
    return `<article class="proof-card"><div class="proof-card-head"><div><span class="eyebrow">RESOURCE NEED · ${esc(item.category)}</span><h3>${esc(item.title)}</h3><p>${esc(item.shelter || item.organisation || 'Organisation')} · ${esc(location)}</p></div>${badge(item.verificationStatus)}</div><p><b>Requested:</b> ${Number(item.requestedQty)} ${esc(item.unit)} of ${esc(item.item)} · <b>Priority:</b> ${esc(item.priority || 'Normal')}</p><p><b>Why required:</b> ${esc(item.description || 'No justification submitted.')}</p><p><b>Linked incident:</b> ${esc(incident?.title || 'Missing incident link')} · <b>NGO registration / proof ID:</b> ${esc(item.ngoProofId || 'Not provided')} · <b>NGO Darpan ID:</b> ${esc(item.ngoDarpanId || 'Not provided')}</p><div class="proof-actions">${item.proofDataUrl ? `<button class="btn btn-outline btn-small" data-action="view-evidence" data-id="${esc(item.id)}" data-kind="need">Open need proof</button>` : '<span class="subtext">No need proof attached</span>'}${source ? `<a class="btn btn-outline btn-small" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Open submitted source ↗</a>` : ''}<a class="btn btn-outline btn-small" href="${mapsSearchUrl(location)}" target="_blank" rel="noopener noreferrer">Check delivery location in Google Maps ↗</a>${hasAdmin() ? `<button class="btn btn-primary btn-small" data-action="review-need" data-id="${esc(item.id)}" data-status="Verified">Verify this need</button><button class="btn btn-danger btn-small" data-action="review-need" data-id="${esc(item.id)}" data-status="Rejected">Reject</button>` : ''}</div></article>`;
  }).join('') : emptyState('No need proofs awaiting review', 'NGO/shelter requests with item-level evidence appear here.');
  const queueMarkup = hasAdmin()
    ? `<div class="proof-queues"><section class="panel"><div class="panel-head"><div><h3>Disaster occurrence evidence</h3><p>${pendingIncidents.length} awaiting administrator review</p></div></div><div class="panel-body proof-list">${incidentQueue}</div></section><section class="panel"><div class="panel-head"><div><h3>Food, shelter and resource need proofs</h3><p>${pendingNeeds.length} awaiting separate review</p></div></div><div class="panel-body proof-list">${needQueue}</div></section></div>`
    : `<section class="panel"><div class="panel-head"><div><h3>Your submitted proofs</h3><p>Review status is assigned by an administrator</p></div></div><div class="panel-body"><p class="muted">Open the NGO dashboard to track request status. Each disaster report and each exact resource need is reviewed separately.</p><button class="btn btn-outline" data-page="overview">Open my dashboard</button></div></section>`;
  const auditMarkup = reviewedProofs.length ? `<section class="panel proof-audit"><div class="panel-head"><div><h3>Review history</h3><p>Administrator decisions and notes recorded in the workspace</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>RECORD</th><th>STATUS</th><th>REVIEWED BY</th><th>REVIEWER VERIFICATION ID</th><th>REVIEW NOTE</th><th>REVIEWED</th><th>REFERENCE</th></tr></thead><tbody>${reviewedProofs.map(item => { const url = safeHttpUrl(item.sourceUrl); return `<tr><td><strong>${esc(item.title)}</strong><span class="subtext">${esc(item.kind)}</span></td><td>${badge(item.status)}</td><td>${esc(item.reviewer || 'Not recorded')}</td><td>${esc(item.reviewerId || 'Not recorded')}</td><td>${esc(item.note || 'No review note')}</td><td>${fmtDateTime(item.date)}</td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : '—'}</td></tr>`; }).join('')}</tbody></table></div></section>` : '';
  return `${pageHeader('EVIDENCE REVIEW', 'Proof & verification portal', 'Cross-check disaster reports, NGO registration references, and the evidence for each food or shelter request.', isNgo() ? '<button class="btn btn-primary" data-action="new-need">＋ Submit a documented need</button>' : '')}
    <div class="verification-banner"><span>ⓘ</span><div><b>Official portal links are references, not an automated verification result</b><p>This version does not scrape or query government or NGO databases. Check the source directly, record your review note, and never mark an incident or need verified from a map pin or uploaded file alone. Google Maps links are for location orientation, not proof of a disaster.</p></div></div>
    ${queueMarkup}
    ${hasAdmin() ? auditMarkup : ''}
    <div class="panel source-panel"><div class="panel-head"><div><h3>Official government and NGO reference portals</h3><p>Open the source and independently confirm the notice or registration details</p></div></div><div class="source-grid">${sourceCards || emptyState('Source directory unavailable', 'Reconnect to the API to load official source references.')}</div></div>`;
}

function renderIncidents() {
  const actions = ['Administrator','NGO partner','Shelter manager','Volunteer'].includes(currentUser?.role) ? `<button class="btn btn-primary" data-action="new-incident">＋ Submit incident report</button>` : '';
  const records = visibleIncidents();
  return `${pageHeader('INCIDENT INTAKE', 'Disaster reports', 'Capture the location, occurrence time, what happened and supporting proof before approving any relief activity.', actions)}
  <div class="verification-banner"><span>ⓘ</span><div><b>Incident verification is a separate step</b><p>Uploaded evidence is not automatic proof. Administrators should cross-check official notices, weather alerts, local authorities and trusted organisations. Cause should be marked as suspected when it is not confirmed.</p></div></div>
  <div class="filter-row"><input id="incidentSearch" class="search-input" placeholder="Search title, location, district…"><select id="incidentStatusFilter" class="filter-select"><option value="">All statuses</option><option>Pending review</option><option>Verified</option><option>Rejected</option></select><select id="incidentTypeFilter" class="filter-select"><option value="">All disaster types</option>${INCIDENT_TYPES.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
  <div id="incidentCards" class="record-cards">${incidentCards(records)}</div>`;
}
function incidentCards(items) { if (!items.length) return `<div class="panel" style="grid-column:1/-1">${emptyState('No disaster reports found', 'Use “Submit incident report” to record a new incident and attach evidence.')}</div>`; return items.map(i => `<article class="record-card"><div class="record-card-head"><div><h3>${esc(i.title)}</h3><div class="location">⌖ ${esc([i.location, i.district, i.state].filter(Boolean).join(', '))}</div></div>${badge(i.status)}</div><div class="record-meta"><div><small>DISASTER TYPE</small><b>${esc(i.type)}</b></div><div><small>OCCURRED</small><b>${fmtDateTime(i.occurredAt)}</b></div><div><small>REPORTED BY</small><b>${esc(i.submittedBy || 'User')}</b></div><div><small>REPORTER VERIFICATION ID</small><b>${esc(i.verificationId || 'Not recorded')}</b></div><div><small>REPORTED ON</small><b>${fmtDate(i.reportedAt)}</b></div></div><p>${esc(i.description)}</p><p><b>Cause:</b> ${esc(i.cause || 'Not provided')}</p>${i.evidenceName ? `<span class="evidence-chip">▧ ${esc(i.evidenceName)}</span>` : '<span class="subtext">No evidence attached</span>'}${i.reviewerNote ? `<p><b>Review note:</b> ${esc(i.reviewerNote)}</p>` : ''}<div class="record-actions">${i.evidenceDataUrl && canViewIncidentEvidence(i) ? `<button class="btn btn-outline btn-small" data-action="view-evidence" data-id="${esc(i.id)}" data-kind="incident">View evidence</button>` : ''}${canReviewIncident(i) ? `<button class="btn btn-primary btn-small" data-action="review-incident" data-id="${esc(i.id)}" data-status="Verified">Verify incident</button><button class="btn btn-danger btn-small" data-action="review-incident" data-id="${esc(i.id)}" data-status="Rejected">Reject</button>` : ''}</div></article>`).join(''); }
function bindIncidentFilters() { const filter = () => { const q = $('#incidentSearch').value.toLowerCase(); const s = $('#incidentStatusFilter').value; const t = $('#incidentTypeFilter').value; const filtered = visibleIncidents().filter(i => (!q || `${i.title} ${i.location} ${i.district} ${i.state}`.toLowerCase().includes(q)) && (!s || i.status === s) && (!t || i.type === t)); $('#incidentCards').innerHTML = incidentCards(filtered); }; ['incidentSearch','incidentStatusFilter','incidentTypeFilter'].forEach(id => $(`#${id}`).addEventListener('input', filter)); }

function renderNeeds() {
  const records = visibleNeeds();
  const actions = `${canManageNeeds() ? '<button class="btn btn-primary" data-action="new-need">＋ Submit resource request</button>' : ''}`;
  return `${pageHeader('RESOURCE COORDINATION', 'Resource requests', 'Shelters must link a request to a verified incident and provide separate proof of the exact item, quantity and location.', actions)}
  <div class="verification-banner"><span>✓</span><div><b>Only verified needs are eligible for matching</b><p>Incident verification is not enough. Each resource request requires its own evidence and administrator review. Sample/demo records must not be treated as real requests.</p></div></div>
  <div class="filter-row"><input id="needSearch" class="search-input" placeholder="Search item, shelter, district…"><select id="needStatusFilter" class="filter-select"><option value="">All verification statuses</option><option>Pending review</option><option>Verified</option><option>Rejected</option><option>Demo / unverified</option></select><select id="needCategoryFilter" class="filter-select"><option value="">All categories</option>${CATEGORIES.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
  <div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>RESOURCE / SHELTER</th><th>LOCATION</th><th>QUANTITY</th><th>PRIORITY</th><th>VERIFICATION</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody id="needsRows">${needRows(records)}</tbody></table></div></div>`;
}
function needRows(items) { if (!items.length) return tableEmpty(7, 'No resource requests found.'); return items.map(n => { const incident = state.incidents.find(i => i.id === n.incidentId); return `<tr><td><strong>${esc(n.title)}</strong><span class="subtext">${esc(n.shelter || n.organisation || 'Community')} · ${esc(n.category)}</span><span class="subtext">Verification ID: ${esc(n.verificationId || n.ngoProofId || 'Not recorded')}</span></td><td>${esc(n.district)}, ${esc(n.state)}<br><span class="subtext">${esc(n.location || '')}</span></td><td><strong>${Number(n.requestedQty || n.quantity || 0)} ${esc(n.unit || 'items')}</strong><span class="subtext">Received ${Number(n.receivedQty || 0)} · Pledged ${Number(n.pledgedQty || 0)}</span></td><td>${badge(n.priority || 'Normal')}</td><td>${badge(n.verificationStatus || 'Demo / unverified')}<br><span class="subtext">${incident ? `Incident: ${esc(incident.title)}` : 'No linked incident'}</span></td><td>${badge(n.status || 'Open')}</td><td><div class="action-group">${n.proofDataUrl && canViewNeedEvidence(n) ? `<button class="btn btn-outline btn-small" data-action="view-evidence" data-id="${esc(n.id)}" data-kind="need">Proof</button>` : ''}${canReviewNeed(n) ? `<button class="btn btn-primary btn-small" data-action="review-need" data-id="${esc(n.id)}" data-status="Verified">Verify</button><button class="btn btn-danger btn-small" data-action="review-need" data-id="${esc(n.id)}" data-status="Rejected">Reject</button>` : ''}${currentUser?.role === 'Donor' && n.verificationStatus === 'Verified' && n.status !== 'Closed' ? `<button class="btn btn-outline btn-small" data-action="pledge-need" data-id="${esc(n.id)}">Pledge</button>` : ''}</div></td></tr>`; }).join(''); }
function bindNeedFilters() { const filter = () => { const q = $('#needSearch').value.toLowerCase(); const s = $('#needStatusFilter').value; const c = $('#needCategoryFilter').value; const items = visibleNeeds().filter(n => (!q || `${n.title} ${n.shelter} ${n.district} ${n.state} ${n.category}`.toLowerCase().includes(q)) && (!s || (n.verificationStatus || 'Demo / unverified') === s) && (!c || n.category === c)); $('#needsRows').innerHTML = needRows(items); }; ['needSearch','needStatusFilter','needCategoryFilter'].forEach(id => $(`#${id}`).addEventListener('input', filter)); }

function renderOffers() { const records = visibleOffers(); const actions = currentUser?.role === 'Donor' ? `<button class="btn btn-primary" data-action="new-offer">＋ Publish donor offer</button>` : '';  return `${pageHeader('SUPPLY NETWORK', 'Donor offers', 'Donors describe what they can supply, the available quantity, service area and availability. Offers are not confirmed deliveries.', actions)}<div class="filter-row"><input id="offerSearch" class="search-input" placeholder="Search item, donor, district…"><select id="offerStatusFilter" class="filter-select"><option value="">All statuses</option><option>Available</option><option>Matched</option><option>Accepted</option><option>Withdrawn</option></select></div><div id="offerCards" class="record-cards">${offerCards(records)}</div>`; }
function offerCards(items) { if (!items.length) return `<div class="panel" style="grid-column:1/-1">${emptyState('No donor offers yet', 'Publish an offer describing the supplies you can provide.')}</div>`; return items.map(o => `<article class="record-card"><div class="record-card-head"><div><h3>${esc(o.item)}</h3><div class="location">${esc(o.category)} · ${esc(o.donorName)}</div><div class="subtext">Donor verification ID: ${esc(o.verificationId || 'Not recorded')}</div></div>${badge(o.status)}</div><div class="record-meta"><div><small>AVAILABLE QUANTITY</small><b>${Number(o.quantity)} ${esc(o.unit)}</b></div><div><small>LOCATION</small><b>${esc(o.district)}, ${esc(o.state)}</b></div><div><small>AVAILABLE UNTIL</small><b>${fmtDate(o.availableUntil)}</b></div><div><small>LINKED NEED</small><b>${esc(state.needs.find(n=>n.id===o.linkedNeedId)?.title || 'Not linked')}</b></div></div><p>${esc(o.notes || 'No additional notes provided.')}</p><div class="record-actions">${(hasAdmin() || (currentUser?.role === 'Donor' && (ownerMatches(o.ownerId) || ownerMatches(o.donorEmail)))) && o.status === 'Available' ? `<button class="btn btn-outline btn-small" data-action="match-offer" data-id="${esc(o.id)}">Match to verified need</button>` : ''}${(hasAdmin() || (currentUser?.role === 'Donor' && (ownerMatches(o.ownerId) || ownerMatches(o.donorEmail)))) && o.status !== 'Withdrawn' && o.status !== 'Accepted' ? `<button class="btn btn-quiet btn-small" data-action="withdraw-offer" data-id="${esc(o.id)}">Withdraw offer</button>` : ''}</div></article>`).join(''); }
function bindOfferFilters() { const filter = () => { const q = $('#offerSearch').value.toLowerCase(); const s = $('#offerStatusFilter').value; $('#offerCards').innerHTML = offerCards(visibleOffers().filter(o => (!q || `${o.item} ${o.donorName} ${o.district} ${o.state}`.toLowerCase().includes(q)) && (!s || o.status === s))); }; ['offerSearch','offerStatusFilter'].forEach(id => $(`#${id}`).addEventListener('input', filter)); }

function renderPledges() { const records = visiblePledges(); const actions = currentUser?.role === 'Donor' ? `<button class="btn btn-outline" data-page="needs">Find verified needs</button>` : ''; const rows = records.map(p => { const n = state.needs.find(x => x.id === p.needId); const canUpdate = hasAdmin() || (currentUser?.role === 'Donor' && (ownerMatches(p.donorEmail) || p.donor === currentUser.name)) || (isNgo() && n && ownerMatches(n.ownerId)); return `<tr><td><strong>${esc(n?.title || 'Resource request')}</strong><span class="subtext">${esc(n?.shelter || '')}</span></td><td>${esc(p.donor)}<span class="subtext">Verification ID: ${esc(p.verificationId || 'Not recorded')}</span></td><td>${Number(p.quantity)} ${esc(n?.unit || 'items')}</td><td>${badge(p.status)}</td><td>${fmtDate(p.createdAt)}</td><td><div class="action-group">${canUpdate && ['Pending','Accepted','In transit','Partially received'].includes(p.status) ? `<button class="btn btn-outline btn-small" data-action="advance-pledge" data-id="${esc(p.id)}">Update status</button>` : '—'}</div></td></tr>`; }).join(''); return `${pageHeader('FULFILMENT TRACKING', isNgo() ? 'Incoming deliveries' : currentUser?.role === 'Donor' ? 'My pledges & deliveries' : 'Pledges & deliveries', isNgo() ? 'Track deliveries attached to your organisation’s resource requests.' : 'Track your donor commitments from pledge to confirmed handover.', actions)}<div class="stats-grid">${statCard('Total pledges', records.length, '⇄', 'Visible to this role')}${statCard('Pending / accepted', records.filter(p=>['Pending','Accepted'].includes(p.status)).length, '◷', 'Awaiting dispatch')}${statCard('In transit', records.filter(p=>p.status==='In transit').length, '↗', 'On the way')}${statCard('Received', records.filter(p=>p.status==='Received').length, '✓', 'Handover recorded')}</div><div class="panel"><div class="panel-head"><div><h3>${isNgo() ? 'Deliveries for my requests' : currentUser?.role === 'Donor' ? 'My delivery register' : 'Delivery register'}</h3><p>Only relevant records are shown in this role workspace.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>NEED</th><th>DONOR</th><th>QUANTITY</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>${rows || tableEmpty(6, 'No relevant pledges yet.')}</tbody></table></div></div>`; }

function renderMap() { const needs = eligibleNeeds(); return `${pageHeader('GEOGRAPHIC OVERVIEW', 'Needs map', 'Explore verified open resource requests by location. Map tiles require an internet connection.', `<button class="btn btn-outline" data-page="needs">View all requests</button>`)}<div class="map-layout"><div class="map-box"><div id="map"></div></div><div><div class="panel-head" style="background:white;border:1px solid var(--line);border-radius:10px;margin-bottom:10px"><div><h3>Verified needs</h3><p>${needs.length} eligible open requests</p></div></div><div class="map-list">${needs.length ? needs.map(n=>`<div class="map-list-item"><b>${esc(n.title)}</b><p>${esc(n.shelter)} · ${esc(n.district)}, ${esc(n.state)}</p><div style="display:flex;justify-content:space-between;align-items:center">${badge(n.priority)}<strong>${Number(n.requestedQty)-Number(n.receivedQty||0)} ${esc(n.unit)} left</strong></div></div>`).join('') : emptyState('No verified needs to map', 'Only verified resource requests are shown here.')}</div></div></div>`; }
function initMap() { const mapEl = $('#map'); if (!mapEl || typeof L === 'undefined') { if (mapEl) mapEl.innerHTML = '<div class="empty-state">Map library could not load. Check your internet connection.</div>'; return; } currentMap = L.map(mapEl).setView([22.5, 79.0], 4.5); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(currentMap); eligibleNeeds().forEach(n => { const lat = Number(n.lat), lng = Number(n.lng); if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) L.marker([lat,lng]).addTo(currentMap).bindPopup(`<b>${esc(n.title)}</b><br>${esc(n.shelter)}<br>${esc(n.district)}, ${esc(n.state)}`); }); setTimeout(() => currentMap?.invalidateSize(), 100); }

function renderPeople() { const action = currentUser?.role === 'Person in need' ? `<button class="btn btn-primary" data-action="new-person-request">＋ Request assistance</button>` : ''; return `${pageHeader('COMMUNITY ASSISTANCE', currentUser?.role === 'Person in need' ? 'My assistance requests' : 'Individual requests', 'Individual requests are limited to the applicant and authorised review roles.', action)}<div class="verification-banner"><span>ⓘ</span><div><b>Protect personal information</b><p>Collect only the minimum details needed. Do not upload Aadhaar numbers, bank details or unnecessary medical information to this demo.</p></div></div><div class="filter-row"><input id="peopleSearch" class="search-input" placeholder="Search item, district or area…"><select id="peopleStatusFilter" class="filter-select"><option value="">All statuses</option><option>Pending review</option><option>Approved</option><option>Rejected</option><option>Fulfilled</option></select></div><div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>ITEM NEEDED</th><th>LOCATION</th><th>QUANTITY</th><th>STATUS</th><th>SUBMITTED</th><th>ACTIONS</th></tr></thead><tbody id="peopleRows">${peopleRows(visiblePeopleRequests())}</tbody></table></div></div>`; }
function peopleRows(items) { if (!items.length) return tableEmpty(6, 'No individual requests have been submitted.'); return items.map(r=>`<tr><td><strong>${esc(r.item)}</strong><span class="subtext">${esc(r.category)} · ${esc(r.description || '')}</span></td><td>${esc(r.area)}, ${esc(r.district)}, ${esc(r.state)}</td><td>${Number(r.quantity)} ${esc(r.unit)}</td><td>${badge(r.status)}</td><td>${fmtDate(r.createdAt)}</td><td>${hasAdmin() && r.status === 'Pending review' ? `<div class="action-group"><button class="btn btn-primary btn-small" data-action="review-person" data-id="${esc(r.id)}" data-status="Approved">Approve</button><button class="btn btn-danger btn-small" data-action="review-person" data-id="${esc(r.id)}" data-status="Rejected">Reject</button></div>` : r.status === 'Approved' && ['Administrator','Shelter manager'].includes(currentUser.role) ? `<button class="btn btn-outline btn-small" data-action="review-person" data-id="${esc(r.id)}" data-status="Fulfilled">Mark fulfilled</button>` : '—'}</td></tr>`).join(''); }
function bindPeopleFilters() { const filter = () => { const q = $('#peopleSearch').value.toLowerCase(); const s = $('#peopleStatusFilter').value; $('#peopleRows').innerHTML = peopleRows(visiblePeopleRequests().filter(r => (!q || `${r.item} ${r.area} ${r.district} ${r.state}`.toLowerCase().includes(q)) && (!s || r.status === s))); }; ['peopleSearch','peopleStatusFilter'].forEach(id => $(`#${id}`).addEventListener('input', filter)); }

function renderDataTools() { return `${pageHeader('WORKSPACE MANAGEMENT', 'Data import / export', 'Download backups, export CSV files for Excel or Power BI, or restore a previously exported JSON workspace.')}<div class="verification-banner"><span>ⓘ</span><div><b>Back up before importing</b><p>Importing a JSON workspace replaces all records in the active database. Save a backup first. CSV is for analysis and cannot be imported as a restore backup.</p></div></div><div class="data-tools"><article class="tool-card"><div class="tool-icon">⇩</div><h3>Export full JSON backup</h3><p>Includes incidents, resource requests, donor offers, pledges, individual assistance requests and user verification profiles.</p><div class="tool-actions"><button class="btn btn-primary" data-action="export-json">Download JSON backup</button></div></article><article class="tool-card"><div class="tool-icon">▤</div><h3>Export CSV for analysis</h3><p>Download a spreadsheet-friendly file for Excel, Power BI or project evaluation.</p><div class="tool-actions"><button class="btn btn-outline" data-action="export-csv" data-kind="incidents">Incidents CSV</button><button class="btn btn-outline" data-action="export-csv" data-kind="needs">Needs CSV</button><button class="btn btn-outline" data-action="export-csv" data-kind="offers">Offers CSV</button><button class="btn btn-outline" data-action="export-csv" data-kind="pledges">Pledges CSV</button><button class="btn btn-outline" data-action="export-csv" data-kind="beneficiaryRequests">Individual requests CSV</button></div></article><article class="tool-card"><div class="tool-icon">⇧</div><h3>Import JSON backup</h3><p>Restore a JSON file previously exported from ReliefLink India. This replaces current workspace records.</p><div class="tool-actions"><label class="btn btn-outline" for="importBackup">Choose JSON backup</label><input id="importBackup" class="file-input" type="file" accept=".json,application/json"></div></article><article class="tool-card"><div class="tool-icon">⌁</div><h3>Workspace status</h3><p>Records saved in the active backend database.</p><div class="record-meta"><div><small>INCIDENTS</small><b>${state.incidents.length}</b></div><div><small>RESOURCE NEEDS</small><b>${state.needs.length}</b></div><div><small>DONOR OFFERS</small><b>${state.offers.length}</b></div><div><small>PLEDGES</small><b>${state.pledges.length}</b></div></div><div class="notice">Last saved: ${state.updatedAt ? fmtDateTime(state.updatedAt) : 'No save timestamp available'}. Database: <code>${$('#databaseStatus').textContent}</code>.</div></article></div>`; }

function openIncidentForm() { openModal({ title: 'Submit disaster report', eyebrow: 'INCIDENT INTAKE', submit: 'Submit for review', fields: [
  {name:'title',label:'Incident title',placeholder:'e.g. Flooding near river-side settlement'}, {name:'type',label:'Disaster type',type:'select',options:INCIDENT_TYPES},
  {name:'state',label:'State / Union Territory',placeholder:'Assam'}, {name:'district',label:'District',placeholder:'Dibrugarh'},
  {name:'location',label:'Specific location / village',placeholder:'Village, ward or landmark',full:true},
  {name:'occurredAt',label:'Date and time occurred',type:'datetime-local'},
  {name:'cause',label:'Cause (confirmed or suspected)',placeholder:'Clearly label suspected cause',required:false},
  {name:'description',label:'What happened and reported impact',type:'textarea',full:true,placeholder:'Describe observations, affected area and source of information…'},
  {name:'sourceUrl',label:'Official notice or source URL',type:'url',required:false,full:true,placeholder:'https://ndma.gov.in/ or an official district notice'},
  {name:'evidence',label:'Supporting evidence',type:'file',full:true,accept:'.pdf,.png,.jpg,.jpeg,.webp,.txt',help:'Attach a relevant photo, official notice or report. Maximum 1 MB for this prototype.'}
], onSubmit: async v => { state.incidents.unshift({ id: uid('inc'), title:v.title.trim(), type:v.type, state:v.state.trim(), district:v.district.trim(), location:v.location.trim(), occurredAt:v.occurredAt, reportedAt:new Date().toISOString(), description:v.description.trim(), cause:v.cause.trim(), sourceUrl:v.sourceUrl.trim(), evidenceName:v.evidenceName || '', evidenceType:v.evidenceType || '', evidenceDataUrl:v.evidenceDataUrl || '', submittedBy:currentUser.name, submittedByRole:currentUser.role, verificationId:currentUser.verificationId, ownerId:currentUser.email || currentUser.name, status:'Pending review', reviewerNote:'' }); if (await saveState()) { renderPage('incidents'); updateCounts(); showToast('Incident submitted for administrator review.'); } } }); }
function openNeedForm() { const verified = state.incidents.filter(i => i.status === 'Verified'); if (!verified.length) { showToast('A verified incident is required before submitting a resource request.', true); renderPage('incidents'); return; } if (!canManageNeeds()) { showToast('Use the Shelter manager role to submit a shelter resource request.', true); return; } openModal({ title:'Submit resource request', eyebrow:'SPECIFIC NEED VERIFICATION', submit:'Submit need for review', fields:[
  {name:'title',label:'Request title',placeholder:'e.g. Drinking water for temporary shelter'}, {name:'shelter',label:'Shelter / organisation name',placeholder:'Organisation or shelter name'},
  {name:'ngoDarpanId',label:'NGO Darpan Unique ID',required:false,placeholder:'If registered; administrator must verify on NGO Darpan'},
  {name:'category',label:'Resource category',type:'select',options:CATEGORIES}, {name:'item',label:'Specific item',placeholder:'e.g. 1-litre water bottles'},
  {name:'requestedQty',label:'Quantity required',type:'number',min:1}, {name:'unit',label:'Unit',placeholder:'bottles, kits, meals, blankets'},
  {name:'state',label:'State',placeholder:'Assam'}, {name:'district',label:'District',placeholder:'Dibrugarh'},
  {name:'location',label:'Specific delivery location',placeholder:'Village, shelter address or landmark',full:true},
  {name:'incidentId',label:'Linked verified incident',type:'select',options:verified.map(i=>({value:i.id,label:`${i.title} — ${i.district}, ${i.state}`})),full:true},
  {name:'priority',label:'Priority',type:'select',options:['Critical','High','Normal']},
  {name:'description',label:'Why is this quantity needed?',type:'textarea',full:true,placeholder:'Explain people affected, current stock, daily consumption, duration needed, and how the requested quantity was calculated.'},
  {name:'sourceUrl',label:'Official assessment or source URL',type:'url',required:false,full:true,placeholder:'Optional district / government assessment link'},
  {name:'evidence',label:'Evidence of this specific need',type:'file',full:true,accept:'.pdf,.png,.jpg,.jpeg,.webp,.txt',help:'Provide item/quantity/site-specific proof such as a signed request, stock record, or current site photo. Maximum 1 MB.'}
], onSubmit: async v => { const inc = state.incidents.find(i => i.id === v.incidentId); if (!inc || inc.status !== 'Verified') throw new Error('Select a verified incident.'); if (!v.description.trim()) throw new Error('Explain why the requested food or shelter resources and quantity are needed.'); state.needs.unshift({ id:uid('need'), shelterId:uid('shelter'), shelter:v.shelter.trim(), organisation:v.shelter.trim(), ngoProofId:isNgo() ? currentUser.verificationId : '', verificationId:currentUser.verificationId, ngoDarpanId:v.ngoDarpanId.trim(), registrationStatus:(isNgo() ? currentUser.verificationId : v.ngoDarpanId.trim()) ? 'Not checked' : 'Not provided', title:v.title.trim(), item:v.item.trim(), category:v.category, state:v.state.trim(), district:v.district.trim(), location:v.location.trim(), lat:0, lng:0, requestedQty:Number(v.requestedQty), pledgedQty:0, receivedQty:0, unit:v.unit.trim(), priority:v.priority, status:'Open', updatedAt:new Date().toISOString(), description:v.description.trim(), sourceUrl:v.sourceUrl.trim(), incidentId:v.incidentId, proofFileName:v.evidenceName || '', proofMimeType:v.evidenceType || '', proofDataUrl:v.evidenceDataUrl || '', verificationStatus:'Pending review', verifierNote:'', ownerId:currentUser.email || currentUser.name }); if (await saveState()) { renderPage('needs'); updateCounts(); showToast('Resource request submitted for separate verification.'); } } }); }
function openOfferForm() { openModal({ title:'Publish donor offer', eyebrow:'SUPPLY NETWORK', submit:'Publish offer', fields:[
  {name:'item',label:'Item you can provide',placeholder:'e.g. Drinking water bottles'}, {name:'category',label:'Category',type:'select',options:CATEGORIES},
  {name:'quantity',label:'Quantity available',type:'number',min:1}, {name:'unit',label:'Unit',placeholder:'bottles, meals, kits'},
  {name:'state',label:'State',placeholder:'Assam'}, {name:'district',label:'District',placeholder:'Guwahati'},
  {name:'availableUntil',label:'Available until',type:'date'}, {name:'linkedNeedId',label:'Link to a verified need',type:'select',required:false,options:[{value:'',label:'No specific request selected'},...eligibleNeeds().map(n=>({value:n.id,label:`${n.title} — ${n.district}, ${n.state}`}))],full:true},
  {name:'notes',label:'Offer / transport notes',type:'textarea',full:true,required:false,placeholder:'Availability, delivery constraints or contact arrangements…'}
], onSubmit: async v => { state.offers.unshift({ id:uid('offer'), donorName:currentUser.name, donorEmail:currentUser.email, verificationId:currentUser.verificationId, item:v.item.trim(), category:v.category, quantity:Number(v.quantity), unit:v.unit.trim(), state:v.state.trim(), district:v.district.trim(), availableUntil:v.availableUntil, linkedNeedId:v.linkedNeedId || '', notes:v.notes.trim(), status:v.linkedNeedId ? 'Matched' : 'Available', createdAt:new Date().toISOString(), ownerId:currentUser.email || currentUser.name }); if (await saveState()) { renderPage('offers'); showToast('Donor offer published. Confirm the handover with the organisation.'); } } }); }
function openPersonForm() { openModal({ title:'Request essential assistance', eyebrow:'COMMUNITY ASSISTANCE', submit:'Submit private request', fields:[
  {name:'category',label:'Category',type:'select',options:CATEGORIES}, {name:'item',label:'Item needed',placeholder:'e.g. food kit'},
  {name:'quantity',label:'Quantity',type:'number',min:1}, {name:'unit',label:'Unit',placeholder:'kits, meals, bottles'},
  {name:'state',label:'State',placeholder:'Assam'}, {name:'district',label:'District',placeholder:'Guwahati'},
  {name:'area',label:'Area / village',placeholder:'Area or village'}, {name:'description',label:'What assistance is needed?',type:'textarea',full:true}
], onSubmit: async v => { state.beneficiaryRequests.unshift({ id:uid('person'), ownerId:currentUser.email || currentUser.name, verificationId:currentUser.verificationId, category:v.category, item:v.item.trim(), quantity:Number(v.quantity), unit:v.unit.trim(), state:v.state.trim(), district:v.district.trim(), area:v.area.trim(), description:v.description.trim(), status:'Pending review', createdAt:new Date().toISOString() }); if (await saveState()) { renderPage('people'); showToast('Assistance request submitted for review.'); } } }); }

function reviewIncident(id, status) {
  if (!hasAdmin()) return showToast('Only an administrator can review incident reports.', true);
  const item = state.incidents.find(record => record.id === id);
  if (!item) return;
  if (status === 'Verified' && !item.evidenceDataUrl && !safeHttpUrl(item.sourceUrl)) return showToast('Attach incident evidence or provide an official source URL before verification.', true);
  openModal({
    title: `${status} incident report`,
    eyebrow: 'EVIDENCE REVIEW',
    submit: `Record ${status.toLowerCase()} decision`,
    fields: [{ name: 'note', label: 'Review note', type: 'textarea', full: true, placeholder: 'Record the official source checked, what matched, and any limits or follow-up needed.' }],
    onSubmit: async values => {
      item.status = status;
      item.reviewerNote = values.note.trim();
      item.reviewedAt = new Date().toISOString();
      item.reviewedBy = currentUser.name;
      item.reviewedByVerificationId = currentUser.verificationId;
      if (await saveState()) { renderPage('verification'); updateCounts(); showToast(`Incident ${status.toLowerCase()}.`); }
    }
  });
}
function reviewNeed(id, status) {
  if (!hasAdmin()) return showToast('Only an administrator can review resource requests.', true);
  const need = state.needs.find(record => record.id === id);
  if (!need) return;
  const incident = state.incidents.find(record => record.id === need.incidentId);
  if (status === 'Verified' && (!incident || incident.status !== 'Verified')) return showToast('The linked incident must be verified first.', true);
  if (status === 'Verified' && !need.proofDataUrl) return showToast('A specific-need evidence file is required.', true);
  if (status === 'Verified' && !need.description?.trim()) return showToast('A documented explanation of why the requested quantity is needed is required.', true);
  openModal({
    title: `${status} resource request`,
    eyebrow: 'ITEM-LEVEL EVIDENCE REVIEW',
    submit: `Record ${status.toLowerCase()} decision`,
    fields: [{ name: 'note', label: 'Review note', type: 'textarea', full: true, placeholder: 'Record the item, quantity, location and need justification you checked, plus the official source used.' }],
    onSubmit: async values => {
      need.verificationStatus = status;
      need.verifierNote = values.note.trim();
      need.verifiedAt = new Date().toISOString();
      need.reviewedBy = currentUser.name;
      need.reviewedByVerificationId = currentUser.verificationId;
      if (await saveState()) { renderPage('verification'); updateCounts(); showToast(`Resource request ${status.toLowerCase()}.`); }
    }
  });
}
async function pledgeNeed(id) { const n=state.needs.find(x=>x.id===id); if (!n || n.verificationStatus !== 'Verified') return showToast('Only verified requests can receive pledges.', true); const max = Math.max(0, Number(n.requestedQty) - Number(n.pledgedQty || 0)); if (!max) return showToast('The requested quantity is already pledged.', true); openModal({ title:'Pledge supplies', eyebrow:'DONOR COMMITMENT', submit:'Record pledge', fields:[{name:'quantity',label:`Quantity to pledge (max ${max} ${n.unit})`,type:'number',min:1,max, value:Math.min(max, 1)},{name:'note',label:'Handover note',type:'textarea',required:false,full:true,placeholder:'Confirm safe handover with the authorised shelter before sending supplies.'}], onSubmit:async v=>{const qty=Number(v.quantity); if(qty<1||qty>max) throw new Error(`Enter a quantity from 1 to ${max}.`); state.pledges.unshift({id:uid('pledge'),needId:id,donor:currentUser.name,donorEmail:currentUser.email,verificationId:currentUser.verificationId,quantity:qty,receivedQty:0,status:'Pending',createdAt:new Date().toISOString(),note:v.note.trim()}); n.pledgedQty=Number(n.pledgedQty||0)+qty; const ok=await saveState(); if(ok){renderPage('pledges');showToast('Pledge recorded. Coordinate handover with the shelter.');}}}); }
async function advancePledge(id) { const p=state.pledges.find(x=>x.id===id); if(!p) return; const linkedNeed = state.needs.find(n=>n.id===p.needId); const allowed = hasAdmin() || (currentUser?.role === 'Donor' && (ownerMatches(p.donorEmail) || p.donor === currentUser.name)) || (isNgo() && linkedNeed && ownerMatches(linkedNeed.ownerId)); if(!allowed) return showToast('You can update only pledges related to your account or organisation.',true); const statuses=['Pending','Accepted','In transit','Partially received','Received','Cancelled']; const next=prompt(`Current status: ${p.status}\nEnter new status exactly:\n${statuses.join(', ')}`); if (next===null) return; if (!statuses.includes(next)) return showToast('Invalid pledge status.',true); if (next==='Received' && !confirm('Confirm that the receiving organisation has acknowledged receipt?')) return; p.status=next; p.updatedAt=new Date().toISOString(); if(next==='Received'){p.receivedQty=p.quantity; const n=state.needs.find(x=>x.id===p.needId); if(n){n.receivedQty=Number(n.receivedQty||0)+Number(p.quantity); if(n.receivedQty>=n.requestedQty)n.status='Fulfilled'; n.updatedAt=new Date().toISOString();}} if(await saveState()){renderPage('pledges');showToast('Pledge status updated.');} }
async function matchOffer(id) { const offer=state.offers.find(x=>x.id===id); if(!offer)return; if(!hasAdmin() && !(currentUser?.role === 'Donor' && (ownerMatches(offer.ownerId) || ownerMatches(offer.donorEmail)))) return showToast('You can match only your own donor offers.',true); const eligible=eligibleNeeds().filter(n=>n.category===offer.category); if(!eligible.length) return showToast('There are no verified open needs in this category.',true); const promptOptions=eligible.map((n,i)=>`${i+1}. ${n.title} — ${n.district}, ${n.state} (need ${n.requestedQty} ${n.unit})`).join('\n'); const answer=prompt(`Choose a verified need number to match:\n${promptOptions}`); if(answer===null)return; const n=eligible[Number(answer)-1]; if(!n)return showToast('Choose a valid number.',true); offer.linkedNeedId=n.id; offer.status='Matched'; if(await saveState()){renderPage('offers');showToast('Offer matched to a verified need. The shelter must still confirm acceptance.');} }
async function withdrawOffer(id) { const offer=state.offers.find(x=>x.id===id); if(!offer)return; if(!hasAdmin() && !(currentUser?.role === 'Donor' && (ownerMatches(offer.ownerId) || ownerMatches(offer.donorEmail)))) return showToast('You can withdraw only your own donor offers.',true); if(!confirm('Withdraw this donor offer?'))return; offer.status='Withdrawn'; if(await saveState()){renderPage('offers');showToast('Offer withdrawn.');} }
async function reviewPerson(id,status) { if(!hasAdmin() && status!=='Fulfilled')return showToast('Only an administrator can review personal requests.',true); const r=state.beneficiaryRequests.find(x=>x.id===id); if(!r)return; if(status==='Fulfilled'&&!['Administrator','Shelter manager'].includes(currentUser.role))return showToast('Only authorised roles can mark a request fulfilled.',true); r.status=status; r.reviewNote=prompt('Optional review note:') || ''; r.reviewedAt=new Date().toISOString(); r.reviewedByVerificationId=currentUser.verificationId; if(await saveState()){renderPage('people');showToast(`Request marked ${status.toLowerCase()}.`);} }
function viewEvidence(id,kind) { const item=(kind==='incident'?state.incidents:state.needs).find(x=>x.id===id); if (kind==='incident' && !canViewIncidentEvidence(item)) return showToast('Uploaded incident evidence is restricted to administrators and the submitting NGO.',true); if (kind==='need' && !canViewNeedEvidence(item)) return showToast('Uploaded need evidence is restricted to administrators and the submitting NGO.',true); const data=item?.evidenceDataUrl || item?.proofDataUrl; const name=item?.evidenceName || item?.proofFileName || 'evidence'; if(!data)return showToast('No evidence file stored.',true); const win=window.open(); if(!win)return showToast('Pop-up blocked. Allow pop-ups to view evidence.',true); if(data.startsWith('data:image/')) win.document.write(`<title>${esc(name)}</title><img src="${data}" style="max-width:100%;height:auto">`); else { const a=win.document.createElement('a'); a.href=data; a.download=name; a.textContent=`Download ${name}`; win.document.body.appendChild(a); win.document.title=name; } }

$('#pageContent').addEventListener('click', async event => {
  const pageBtn=event.target.closest('[data-page]'); if(pageBtn){renderPage(pageBtn.dataset.page);return;}
  const btn=event.target.closest('[data-action]'); if(!btn)return; const {action,id,status,kind}=btn.dataset;
  if(action==='edit-profile') return openProfileEditor();
  if(action==='new-incident') { if (!['Administrator','NGO partner','Shelter manager','Volunteer'].includes(currentUser?.role)) return showToast('This role cannot submit incident reports.',true); return openIncidentForm(); }
  if(action==='new-need') { if (!canManageNeeds()) return showToast('Only administrators, NGOs and shelter managers can submit resource needs.',true); return openNeedForm(); }
  if(action==='new-offer') { if (currentUser?.role !== 'Donor') return showToast('Only donor accounts can publish donor offers.',true); return openOfferForm(); }
  if(action==='new-person-request') { if (currentUser?.role !== 'Person in need') return showToast('Use a Person in need account to submit a personal assistance request.',true); return openPersonForm(); }
  if(action==='review-incident') return reviewIncident(id,status); if(action==='review-need') return reviewNeed(id,status); if(action==='pledge-need') { if (currentUser?.role !== 'Donor') return showToast('Only donors can pledge supplies.',true); return pledgeNeed(id); } if(action==='advance-pledge') return advancePledge(id); if(action==='match-offer') return matchOffer(id); if(action==='withdraw-offer') return withdrawOffer(id); if(action==='review-person') return reviewPerson(id,status); if(action==='view-evidence') return viewEvidence(id,kind);
  if(action==='export-json') { if (!hasAdmin()) return showToast('Only administrators can export a full workspace backup.',true); return downloadFile(`relieflink-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2)); }
  if(action==='export-csv') { if (!hasAdmin()) return showToast('Only administrators can export workspace CSV files.',true); return exportCSV(kind); }
});
function exportCSV(kind) { const config={incidents:{rows:state.incidents,fields:['id','title','type','state','district','location','occurredAt','reportedAt','description','cause','status','submittedBy','verificationId','reviewedBy','reviewedByVerificationId','reviewerNote']},needs:{rows:state.needs,fields:['id','title','shelter','organisation','category','state','district','location','requestedQty','pledgedQty','receivedQty','unit','priority','status','verificationStatus','incidentId','verificationId','ngoProofId','reviewedBy','reviewedByVerificationId','description','verifierNote']},offers:{rows:state.offers,fields:['id','donorName','donorEmail','verificationId','category','item','quantity','unit','state','district','availableUntil','linkedNeedId','status','createdAt','notes']},pledges:{rows:state.pledges,fields:['id','needId','donor','donorEmail','verificationId','quantity','receivedQty','status','createdAt']},beneficiaryRequests:{rows:state.beneficiaryRequests,fields:['id','ownerId','verificationId','category','item','quantity','unit','state','district','area','status','createdAt','reviewedByVerificationId']}}[kind]; if(!config)return; const csv=[config.fields.map(escapeCSV).join(','),...config.rows.map(row=>config.fields.map(f=>escapeCSV(row[f])).join(','))].join('\r\n'); downloadFile(`relieflink-${kind}-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8'); }

$('#pageContent').addEventListener('change', async event => { if(event.target.id!=='importBackup')return; if(!hasAdmin()) return showToast('Only administrators can restore a full workspace backup.',true); const file=event.target.files?.[0]; event.target.value=''; if(!file)return; if(file.size>12*1024*1024)return showToast('Backup is larger than the 12 MB import limit.',true); let parsed; try{parsed=JSON.parse(await file.text());}catch{return showToast('That file is not valid JSON.',true);} if(!parsed||typeof parsed!=='object'||COLLECTIONS.some(k=>parsed[k]!==undefined&&!Array.isArray(parsed[k])))return showToast('Backup structure is invalid. Export a ReliefLink JSON backup.',true); if(!confirm('Importing will replace the current workspace data. Have you exported a backup of current data? Continue?'))return; state={...structuredClone(EMPTY_STATE),...Object.fromEntries(COLLECTIONS.map(k=>[k,Array.isArray(parsed[k])?parsed[k]:[]]))}; stateDirty=true; try{const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)}); if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'Import failed');} state={...structuredClone(EMPTY_STATE),...(await response.json())};lastSyncedState=structuredClone(state);stateDirty=false;renderPage('data');updateCounts();showToast('JSON backup imported.');}catch(error){console.error(error);showToast(error.message||'Could not import backup.',true);} });

// Role-based navigation is a presentation aid; the API also requires a server-side session.
async function init() {
  try {
    const response = await fetch('/api/auth/session');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not restore your sign-in session.');
    if (result.user) await enterWorkspace(result.user);
  } catch (error) {
    console.error('Could not restore the authenticated session:', error);
    currentUser = null;
    showToast(error.message || 'Could not restore your sign-in session.', true);
  }
}
window.addEventListener('focus', refreshWorkspace);
init();
