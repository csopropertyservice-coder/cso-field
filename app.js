/**
 * CSO Field — app.js
 * ─────────────────────────────────────────────────────────────────
 * Architecture:
 *   Store      — Observable state container. Single source of truth.
 *   Validator  — Modular form validation (required, pattern, range).
 *   UI helpers — Toast, modal, nav helpers.
 *   Pages      — Per-page render functions subscribed to the Store.
 *
 * Pattern: "boring and explicit" observer.
 *   store.subscribe(listener)  → called on every state change.
 *   store.set(key, value)      → updates state + persists + notifies.
 *   store.get(key)             → reads current state.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   STORE  —  Simple observable state with localStorage persistence
═══════════════════════════════════════════════════════════════ */

/**
 * @class Store
 * Central state container. All reads and writes go through here.
 * Notifies registered listeners synchronously after each mutation.
 *
 * Usage:
 *   store.set('jobs', [...jobs]);       // mutate
 *   const jobs = store.get('jobs');     // read
 *   store.subscribe(key, fn);           // observe a specific key
 *   store.subscribeAll(fn);             // observe any change
 */
class Store {
  /**
   * @param {string} storageKey  localStorage key
   * @param {Object} defaults    Initial state shape
   */
  constructor(storageKey, defaults) {
    this._key       = storageKey;
    this._listeners = {};       // { key: [fn, fn, ...] }
    this._allListeners = [];    // listeners for any change
    this._state     = this._load(defaults);
  }

  /** Load persisted state, merged over defaults */
  _load(defaults) {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) return Object.assign({}, defaults, JSON.parse(raw));
    } catch (_) { /* ignore corrupt data */ }
    return Object.assign({}, defaults);
  }

  /** Persist current state to localStorage */
  _persist() {
    try { localStorage.setItem(this._key, JSON.stringify(this._state)); }
    catch (_) { console.warn('CSO Field: localStorage write failed.'); }
  }

  /** Notify listeners for a specific key + all-listeners */
  _notify(key) {
    const value = this._state[key];
    (this._listeners[key] || []).forEach(fn => fn(value, key));
    this._allListeners.forEach(fn => fn(key, value));
  }

  /**
   * Read a value from state.
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    return this._state[key];
  }

  /**
   * Write a value to state, persist, and notify.
   * @param {string} key
   * @param {*}      value
   */
  set(key, value) {
    this._state[key] = value;
    this._persist();
    this._notify(key);
  }

  /**
   * Patch a plain-object value (shallow merge).
   * @param {string} key
   * @param {Object} patch
   */
  patch(key, patch) {
    const current = this._state[key];
    if (typeof current !== 'object' || current === null) {
      throw new TypeError(`Store.patch: "${key}" is not an object.`);
    }
    this.set(key, Object.assign({}, current, patch));
  }

  /**
   * Subscribe to changes on a specific key.
   * @param {string}   key
   * @param {Function} fn   Called with (newValue, key)
   * @returns {Function}    Unsubscribe function
   */
  subscribe(key, fn) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
    return () => {
      this._listeners[key] = this._listeners[key].filter(f => f !== fn);
    };
  }

  /**
   * Subscribe to any state change.
   * @param {Function} fn   Called with (key, newValue)
   * @returns {Function}    Unsubscribe function
   */
  subscribeAll(fn) {
    this._allListeners.push(fn);
    return () => {
      this._allListeners = this._allListeners.filter(f => f !== fn);
    };
  }
}

/* ── Default state shape ─────────────────────────────────────── */
const DEFAULT_STATE = {
  jobs:            [],
  estimates:       [],
  invoices:        [],
  clients:         [],
  materials:       [],
  crew:            [],
  checklists:      [],
  bookingRequests: [],
  bookingSettings: {},
  profile: {
    company:  '',
    trade:    'General Contractor',
    license:  '',
    state:    'Texas',
    rate:     75,
    overhead: 15,
    goal:     8000,
    jobGoal:  15,
    plan:     'Free',
  },
  onboarded: false,
};

/** Singleton store instance */
const store = new Store('cso_field_data', DEFAULT_STATE);

/* ═══════════════════════════════════════════════════════════════
   VALIDATOR  —  Modular, accessible form validation
═══════════════════════════════════════════════════════════════ */

/**
 * @class Validator
 * Attach to any form by passing an array of field rules.
 * Renders inline error messages and applies ARIA attributes.
 *
 * Rules:
 *   { field: 'id', required: true }
 *   { field: 'id', pattern: /regex/, message: 'Custom message' }
 *   { field: 'id', min: 0, max: 100 }
 *   { field: 'id', custom: (value) => true | 'error message' }
 *
 * Usage:
 *   const v = new Validator([
 *     { field: 'aj-client', required: true, label: 'Client name' },
 *     { field: 'aj-value',  required: true, min: 1, label: 'Job value' },
 *   ]);
 *   if (!v.validate()) return;  // stops submission
 */
class Validator {
  /**
   * @param {Array<Object>} rules
   */
  constructor(rules) {
    this._rules = rules;
  }

  /**
   * Run all rules. Returns true if all pass, false otherwise.
   * Side-effects: renders inline error messages.
   * @returns {boolean}
   */
  validate() {
    let valid = true;

    for (const rule of this._rules) {
      const el = document.getElementById(rule.field);
      if (!el) continue;

      this._clearError(el);
      const raw   = el.value.trim();
      const num   = parseFloat(raw);
      let   error = null;

      // Required
      if (rule.required && raw === '') {
        error = `${rule.label || 'This field'} is required.`;
      }

      // Pattern
      if (!error && rule.pattern && raw !== '') {
        if (!rule.pattern.test(raw)) {
          error = rule.message || `${rule.label || 'This field'} format is invalid.`;
        }
      }

      // Numeric range
      if (!error && rule.min !== undefined && raw !== '') {
        if (isNaN(num) || num < rule.min) {
          error = `${rule.label || 'Value'} must be at least ${rule.min}.`;
        }
      }
      if (!error && rule.max !== undefined && raw !== '') {
        if (isNaN(num) || num > rule.max) {
          error = `${rule.label || 'Value'} must be at most ${rule.max}.`;
        }
      }

      // Custom function  (value) => true | 'error string'
      if (!error && typeof rule.custom === 'function' && raw !== '') {
        const result = rule.custom(raw);
        if (typeof result === 'string') error = result;
      }

      if (error) {
        this._showError(el, error);
        valid = false;
      } else if (raw !== '') {
        el.classList.add('is-valid');
        el.setAttribute('aria-invalid', 'false');
      }
    }

    return valid;
  }

  /** Clear validation state from a field */
  _clearError(el) {
    el.classList.remove('is-invalid', 'is-valid');
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
    const existing = document.getElementById(`err-${el.id}`);
    if (existing) existing.remove();
  }

  /** Render an inline error below the field */
  _showError(el, message) {
    el.classList.add('is-invalid');
    el.setAttribute('aria-invalid', 'true');

    const errId  = `err-${el.id}`;
    el.setAttribute('aria-describedby', errId);

    const div    = document.createElement('div');
    div.id       = errId;
    div.className = 'field-error';
    div.setAttribute('role', 'alert');
    div.textContent = message;

    el.insertAdjacentElement('afterend', div);
    el.focus();   // focus first error field
  }

  /** Clear all validation state across all rules */
  clearAll() {
    for (const rule of this._rules) {
      const el = document.getElementById(rule.field);
      if (el) this._clearError(el);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   APP STATE  —  Non-persisted runtime state
═══════════════════════════════════════════════════════════════ */
let _user        = null;     // currently signed-in user
let _editJobId   = null;     // null = new job, string = editing existing
let _billingYrly = false;    // pricing toggle
let _gpsMap      = null;     // Leaflet map instance
let _gpsMarkers  = {};       // { userId: L.Marker }
let _gpsWatchId  = null;     // navigator.geolocation watchId
let _gpsLocs     = JSON.parse(localStorage.getItem('cso_field_gps') || '{}');
let _calYear     = new Date().getFullYear();
let _calMonth    = new Date().getMonth();

/* Pre-built validators (reused on each modal open) */
let _jobValidator;

/* ═══════════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════════ */

/** Escape HTML to prevent XSS */
const esc = s =>
  String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/** Format a number as USD currency */
const fmtMoney = n =>
  '$' + parseFloat(n ?? 0).toLocaleString('en-US',{ minimumFractionDigits:0, maximumFractionDigits:2 });

/** Relative time string */
const timeAgo = ts => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return Math.floor(s/60)   + 'm ago';
  return         Math.floor(s/3600) + 'h ago';
};

/* ── Toast ───────────────────────────────── */
/**
 * Show a temporary notification.
 * @param {string} msg
 * @param {'success'|'error'|'info'} type
 */
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  const icons = { success:'✓', error:'✕', info:'i' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="font-weight:800;">${icons[type]||'i'}</span><span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ── Modal ───────────────────────────────── */
const openModal  = id => document.getElementById(id)?.classList.add('open');
const closeModal = id => document.getElementById(id)?.classList.remove('open');

/* ── Nav ─────────────────────────────────── */
const PAGE_TITLES = {
  dashboard:'Dashboard', jobs:'Job Manager', calendar:'Job Calendar',
  profit:'Profit Calculator', estimates:'Estimates', invoices:'Invoices',
  materials:'Materials', clients:'Clients', crew:'Crew Manager',
  gps:'GPS Tracking', booking:'Online Booking', checklist:'Checklists',
  documents:'Documents', ai:'AI Assistant', overhead:'Overhead Analyzer',
  goals:'Goals', settings:'Settings',
};

/** Navigate to a page by id. Updates sidebar highlight and topbar title. */
function navTo(page, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] ?? page;

  // Per-page side-effects
  if (page === 'dashboard') renderDashboard();
  if (page === 'calendar')  renderCalendar();
  if (page === 'jobs')      renderJobs();
  if (page === 'clients')   renderClients();
  if (page === 'materials') renderMaterials();
  if (page === 'crew')      renderCrew();
  if (page === 'invoices')  renderInvoices();
  if (page === 'estimates') renderEstimates();
  if (page === 'goals')     renderGoals();
  if (page === 'checklist') renderChecklists();
  if (page === 'gps')       initGPS();
  if (page === 'booking')   renderBookingPage();
  if (page === 'profit') {
    const p = store.get('profile');
    const rateEl = document.getElementById('pc-rate');
    const ohEl   = document.getElementById('pc-overhead');
    if (rateEl) rateEl.value = p.rate ?? 75;
    if (ohEl)   ohEl.value   = p.overhead ?? 15;
  }
}

function toggleSidebar() {
  document.getElementById('app')?.classList.toggle('sb-collapsed');
}

/* ── Theme ───────────────────────────────── */
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cso_field_theme', next);
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = next === 'dark' ? 'Light' : 'Dark';
}

/* ── Mobile menu ─────────────────────────── */
function toggleMenu() {
  const m = document.getElementById('lp-mobile-menu');
  const b = document.getElementById('lp-hamburger');
  const o = m.classList.contains('open');
  m.classList.toggle('open', !o);
  b.classList.toggle('open', !o);
}
function closeMenu() {
  document.getElementById('lp-mobile-menu')?.classList.remove('open');
  document.getElementById('lp-hamburger')?.classList.remove('open');
}

/* ── Pricing toggle ──────────────────────── */
function toggleBilling() {
  _billingYrly = !_billingYrly;
  document.getElementById('billing-toggle')?.classList.toggle('yearly', _billingYrly);
  document.getElementById('toggle-mo-lbl')?.classList.toggle('active', !_billingYrly);
  document.getElementById('toggle-yr-lbl')?.classList.toggle('active', _billingYrly);
  const badge = document.getElementById('toggle-save');
  if (badge) badge.style.display = _billingYrly ? '' : 'none';
  document.querySelectorAll('.price-num[data-monthly]').forEach(el => {
    el.textContent = _billingYrly ? el.dataset.yearly : el.dataset.monthly;
  });
  document.querySelectorAll('.price-yearly-note').forEach(el => {
    el.style.display = _billingYrly ? '' : 'none';
  });
}

/* ═══════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════ */
function showLogin() {
  document.getElementById('auth-title').textContent = 'Sign In';
  document.getElementById('auth-login-view').style.display  = '';
  document.getElementById('auth-signup-view').style.display = 'none';
  openModal('modal-auth');
}

function showSignup() {
  document.getElementById('auth-title').textContent = 'Create Account';
  document.getElementById('auth-login-view').style.display  = 'none';
  document.getElementById('auth-signup-view').style.display = '';
  openModal('modal-auth');
}

function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  if (!email || !pass) { toast('Please fill in all fields', 'error'); return; }
  _user = { id: `demo-${Date.now()}`, email, name: 'Demo User' };
  closeModal('modal-auth');
  enterApp();
}

function doSignup() {
  const v = new Validator([
    { field: 'su-fname', required: true, label: 'First name' },
    { field: 'su-email', required: true, label: 'Email',
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address.' },
    { field: 'su-pass',  required: true, label: 'Password', min: 8,
      custom: v => v.length >= 8 || 'Password must be at least 8 characters.' },
  ]);
  if (!v.validate()) return;

  const fname = document.getElementById('su-fname').value.trim();
  const lname = document.getElementById('su-lname').value.trim();
  const email = document.getElementById('su-email').value.trim();
  _user = { id: `demo-${Date.now()}`, email, name: `${fname} ${lname}`.trim() };
  closeModal('modal-auth');
  if (!store.get('onboarded')) showOnboarding();
  else enterApp();
}

function doLogout() {
  _user = null;
  document.getElementById('app').classList.remove('visible');
  document.getElementById('landing').style.display = '';
  toast('Signed out', 'info');
}

function enterApp() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  _loadProfile();
  fetchWeather();
  renderDashboard();
  renderCalendar();
  _greetUser();
}

/* ═══════════════════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════════════════ */
function showOnboarding() { document.getElementById('onboarding').classList.add('open'); }

function obNext(step) {
  document.querySelectorAll('.onboard-step').forEach(s => s.classList.remove('active'));
  document.getElementById(`ob-${step}`)?.classList.add('active');
  document.querySelectorAll('.onboard-dot').forEach((d, i) => {
    d.classList.remove('active', 'done');
    if (i < step - 1) d.classList.add('done');
    else if (i === step - 1) d.classList.add('active');
  });
}

function finishOnboarding() {
  const v = new Validator([
    { field: 'ob-company', required: true, label: 'Business name' },
  ]);
  if (!v.validate()) return;

  store.patch('profile', {
    company:  document.getElementById('ob-company').value || 'My Business',
    trade:    document.getElementById('ob-trade').value,
    state:    document.getElementById('ob-state').value,
    license:  document.getElementById('ob-license')?.value ?? '',
    rate:     parseFloat(document.getElementById('ob-rate').value)     || 75,
    overhead: parseFloat(document.getElementById('ob-overhead').value) || 15,
    goal:     parseFloat(document.getElementById('ob-goal').value)     || 8000,
  });
  store.set('onboarded', true);
  document.getElementById('onboarding').classList.remove('open');
  enterApp();
  toast('Welcome to CSO Field!', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   PROFILE & SETTINGS
═══════════════════════════════════════════════════════════════ */
function _loadProfile() {
  const p    = store.get('profile');
  const name = _user?.name ?? 'Contractor';
  const init = name.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2);
  const avEl = document.getElementById('sb-avatar');
  const nmEl = document.getElementById('sb-name');
  const plEl = document.getElementById('sb-plan');
  if (avEl) avEl.textContent = init;
  if (nmEl) nmEl.textContent = name;
  if (plEl) plEl.textContent = `${p.plan ?? 'Free'} Plan`;
  _loadSettingsForm();
}

function _loadSettingsForm() {
  const p = store.get('profile');
  const fields = ['company','trade','license','state'];
  fields.forEach(k => {
    const el = document.getElementById(`set-${k}`);
    if (el) el.value = p[k] ?? '';
  });
  ['rate','overhead','goal'].forEach(k => {
    const el = document.getElementById(`set-${k}`);
    if (el) el.value = p[k] ?? '';
  });
}

function saveSettings() {
  const v = new Validator([
    { field: 'set-company', required: true, label: 'Business name' },
    { field: 'set-rate',    required: true, min: 1, max: 9999, label: 'Hourly rate' },
  ]);
  if (!v.validate()) return;

  store.patch('profile', {
    company:  document.getElementById('set-company').value,
    trade:    document.getElementById('set-trade').value,
    license:  document.getElementById('set-license').value,
    state:    document.getElementById('set-state').value,
    rate:     parseFloat(document.getElementById('set-rate').value)     || 75,
    overhead: parseFloat(document.getElementById('set-overhead').value) || 15,
    goal:     parseFloat(document.getElementById('set-goal').value)     || 8000,
  });
  toast('Settings saved!', 'success');
}

function exportData() {
  const jobs = store.get('jobs');
  const rows = [['Job ID','Client','Type','Value','Status','Date']];
  jobs.forEach(j => rows.push([j.id, j.client, j.type, j.value, j.status, j.date]));
  const csv  = rows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'cso-field-export.csv';
  a.click();
  toast('Data exported!', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   WEATHER  (Open-Meteo — free, no key)
═══════════════════════════════════════════════════════════════ */
async function fetchWeather() {
  try {
    const res  = await fetch('https://api.open-meteo.com/v1/forecast?latitude=32.7767&longitude=-96.7970&current=temperature_2m,weathercode&temperature_unit=fahrenheit');
    const d    = await res.json();
    const temp = Math.round(d.current.temperature_2m);
    const code = d.current.weathercode;
    const icon = code <= 1 ? 'Clear' : code <= 3 ? 'Cloudy' : code <= 48 ? 'Foggy' : code <= 67 ? 'Rain' : code <= 82 ? 'Showers' : 'Storm';
    const txt  = `${icon} · ${temp}°F`;
    const wEl  = document.getElementById('topbar-weather');
    const dwEl = document.getElementById('dash-weather');
    if (wEl)  wEl.textContent  = txt;
    if (dwEl) dwEl.textContent = txt;
  } catch (_) {
    const wEl = document.getElementById('topbar-weather');
    if (wEl) wEl.textContent = 'Weather N/A';
  }
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════ */
function _greetUser() {
  const h   = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const el  = document.getElementById('dash-greeting');
  if (el) el.textContent = `${greet} — ready to build something great today.`;
}

/**
 * Subscribe dashboard to jobs + profile changes so it auto-rerenders.
 */
function renderDashboard() {
  const now   = new Date();
  const jobs  = store.get('jobs');
  const p     = store.get('profile');
  const month = jobs.filter(j => {
    const d = new Date(j.date || j.created || now);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const rev    = month.reduce((s, j) => s + (parseFloat(j.value)     || 0), 0);
  const profit = month.reduce((s, j) => s + (parseFloat(j.netProfit) || 0), 0);
  const avg    = month.length ? rev / month.length : 0;
  const active = jobs.filter(j => j.status === 'In Progress' || j.status === 'Scheduled').length;

  _setText('stat-rev',       fmtMoney(rev));
  _setText('stat-rev-sub',   `${month.length} jobs this month`);
  _setText('stat-profit',    fmtMoney(profit));
  _setText('stat-avg',       fmtMoney(avg));
  _setText('stat-active',    String(active));
  _setText('stat-active-sub',`${jobs.filter(j => j.status === 'In Progress').length} in progress`);

  const goal = p.goal || 8000;
  const pct  = Math.min(100, Math.round(rev / goal * 100));
  _setText('goal-pct',    `${pct}%`);
  _setText('goal-earned', `${fmtMoney(rev)} earned`);
  _setText('goal-target', `Goal: ${fmtMoney(goal)}`);
  const barEl = document.getElementById('goal-bar');
  if (barEl) barEl.style.width = `${pct}%`;

  // Recent jobs
  const rEl = document.getElementById('dash-recent-jobs');
  if (rEl) {
    const recent = jobs.slice(-4).reverse();
    if (!recent.length) {
      rEl.innerHTML = '<div style="text-align:center;padding:28px;color:var(--txt3);font-size:14px;">No jobs yet. <a href="#" onclick="navTo(\'jobs\',null);openAddJob()">Add your first job →</a></div>';
    } else {
      rEl.innerHTML = recent.map(j => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border2);">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--txt);">${esc(j.client)}</div>
            <div style="font-size:11px;color:var(--txt3);">${j.type} · ${j.date || 'TBD'}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:14px;font-weight:700;color:#2E9E6B;">${fmtMoney(j.value)}</div>
            <span class="badge ${statusBadge(j.status)}">${j.status}</span>
          </div>
        </div>`).join('');
    }
  }
}

/* ── Store subscriptions for dashboard auto-refresh ── */
store.subscribe('jobs',    renderDashboard);
store.subscribe('profile', () => { renderDashboard(); _loadProfile(); });

/* ═══════════════════════════════════════════════════════════════
   JOBS
═══════════════════════════════════════════════════════════════ */

/** Build the job form validator once and reuse it */
function _buildJobValidator() {
  return new Validator([
    { field: 'aj-client',  required: true, label: 'Client name' },
    { field: 'aj-value',   required: true, min: 1, label: 'Job value' },
    { field: 'aj-address', required: false },
  ]);
}

function openAddJob() {
  _editJobId = null;
  document.getElementById('job-modal-title').textContent = 'Add New Job';
  ['aj-client','aj-address','aj-notes'].forEach(id => _setVal(id, ''));
  ['aj-value','aj-hours'].forEach(id => _setVal(id, ''));
  _setVal('aj-status', 'Scheduled');
  _setVal('aj-date', new Date().toISOString().split('T')[0]);
  _jobValidator = _buildJobValidator();
  _jobValidator.clearAll();
  openModal('modal-add-job');
}

function saveJob() {
  if (!_jobValidator) _jobValidator = _buildJobValidator();
  if (!_jobValidator.validate()) return;

  const client   = document.getElementById('aj-client').value.trim();
  const value    = parseFloat(document.getElementById('aj-value').value) || 0;
  const hours    = parseFloat(document.getElementById('aj-hours').value) || 0;
  const p        = store.get('profile');
  const rate     = p.rate     || 75;
  const overhead = p.overhead || 15;
  const laborCost  = hours * rate;
  const overheadCost = value * (overhead / 100);

  const job = {
    id:          _editJobId || `J${Date.now()}`,
    client,
    type:        document.getElementById('aj-type').value,
    address:     document.getElementById('aj-address').value,
    value,
    hours,
    status:      document.getElementById('aj-status').value,
    date:        document.getElementById('aj-date').value,
    notes:       document.getElementById('aj-notes').value,
    netProfit:   Math.round((value - laborCost - overheadCost) * 100) / 100,
    laborCost:   Math.round(laborCost * 100) / 100,
    created:     new Date().toISOString(),
  };

  const jobs = [...store.get('jobs')];
  if (_editJobId) {
    const idx = jobs.findIndex(j => j.id === _editJobId);
    if (idx > -1) jobs[idx] = job; else jobs.push(job);
  } else {
    jobs.push(job);
  }

  store.set('jobs', jobs);   // triggers all subscribers
  closeModal('modal-add-job');
  toast(_editJobId ? 'Job updated!' : 'Job added!', 'success');
}

store.subscribe('jobs', renderJobs);

function renderJobs() {
  const search = document.getElementById('job-search')?.value.toLowerCase() ?? '';
  const sf     = document.getElementById('job-status-filter')?.value ?? '';
  const jobs   = store.get('jobs')
    .filter(j => {
      if (sf && j.status !== sf) return false;
      if (search && !`${j.client}${j.type}${j.address}${j.status}`.toLowerCase().includes(search)) return false;
      return true;
    })
    .slice()
    .reverse();

  const c = document.getElementById('jobs-container');
  if (!c) return;

  if (!jobs.length) {
    c.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:56px;color:var(--txt3);">
      <div style="font-size:16px;font-weight:600;margin-bottom:6px;">No jobs found</div>
      <button class="btn btn-pri" onclick="openAddJob()">+ Add Job</button>
    </div>`;
    return;
  }

  c.innerHTML = jobs.map(j => `
    <div class="job-card" onclick="editJob('${j.id}')">
      <div class="job-card-hd">
        <div>
          <div class="job-client">${esc(j.client)}</div>
          <div style="font-size:12px;color:var(--txt3);margin-top:2px;">${j.type} · ${j.address || 'No address'}</div>
        </div>
        <div style="text-align:right;">
          <div class="job-value">${fmtMoney(j.value)}</div>
          <span class="badge ${statusBadge(j.status)}">${j.status}</span>
        </div>
      </div>
      <div class="job-meta">
        <div class="job-meta-item"><strong>${j.date || 'TBD'}</strong></div>
        ${j.hours ? `<div class="job-meta-item"><strong>${j.hours}h</strong> est</div>` : ''}
        <div class="job-meta-item">Net: <strong style="color:#2E9E6B;">${fmtMoney(j.netProfit)}</strong></div>
      </div>
      <div style="display:flex;gap:7px;margin-top:12px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();editJob('${j.id}')">Edit</button>
        <button class="btn btn-ghost   btn-sm" onclick="event.stopPropagation();advanceJobStatus('${j.id}')">Advance</button>
        <button class="btn btn-ghost   btn-sm" onclick="event.stopPropagation();createInvoiceFromJob('${j.id}')">Invoice</button>
        <button class="btn btn-danger  btn-sm" onclick="event.stopPropagation();deleteJob('${j.id}')">Delete</button>
      </div>
    </div>`).join('');
}

function editJob(id) {
  const j = store.get('jobs').find(x => x.id === id);
  if (!j) return;
  _editJobId = id;
  document.getElementById('job-modal-title').textContent = 'Edit Job';
  _setVal('aj-client',  j.client  ?? '');
  _setVal('aj-address', j.address ?? '');
  _setVal('aj-value',   j.value   ?? '');
  _setVal('aj-hours',   j.hours   ?? '');
  _setVal('aj-status',  j.status  ?? 'Scheduled');
  _setVal('aj-date',    j.date    ?? '');
  _setVal('aj-notes',   j.notes   ?? '');
  _jobValidator = _buildJobValidator();
  _jobValidator.clearAll();
  openModal('modal-add-job');
}

function deleteJob(id) {
  store.set('jobs', store.get('jobs').filter(j => j.id !== id));
  toast('Job deleted', 'info');
}

function advanceJobStatus(id) {
  const statuses = ['Estimate','Scheduled','In Progress','Complete','Invoiced','Paid'];
  const jobs = store.get('jobs').map(j => {
    if (j.id !== id) return j;
    const next = statuses[(statuses.indexOf(j.status) + 1) % statuses.length];
    return { ...j, status: next };
  });
  store.set('jobs', jobs);
  toast('Status updated', 'success');
}

function filterJobStatus(status, el) {
  document.querySelectorAll('.pipeline-step').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  const sf = document.getElementById('job-status-filter');
  if (sf) sf.value = status;
  renderJobs();
}

const statusBadge = s => ({
  Estimate:'badge-blue', Scheduled:'badge-orange', 'In Progress':'badge-orange',
  Complete:'badge-gray', Invoiced:'badge-orange', Paid:'badge-green',
}[s] ?? 'badge-gray');

/* ═══════════════════════════════════════════════════════════════
   PROFIT CALCULATOR
═══════════════════════════════════════════════════════════════ */
function calcProfit() {
  const v   = parseFloat(document.getElementById('pc-value')?.value) || 0;
  const h   = parseFloat(document.getElementById('pc-hours')?.value) || 0;
  const r   = parseFloat(document.getElementById('pc-rate')?.value)  || 75;
  const m   = parseFloat(document.getElementById('pc-materials')?.value) || 0;
  const oh  = parseFloat(document.getElementById('pc-overhead')?.value) || 15;
  const sub = parseFloat(document.getElementById('pc-subs')?.value)    || 0;
  const tr  = parseFloat(document.getElementById('pc-travel')?.value)  || 0;
  const pr  = parseFloat(document.getElementById('pc-permits')?.value) || 0;
  if (!v) return;

  const labor = h * r;
  const overh = v * (oh / 100);
  const total = labor + m + overh + sub + tr + pr;
  const net   = v - total;
  const marg  = v > 0 ? (net / v * 100) : 0;
  const col   = net > 0 ? '#2E9E6B' : 'var(--red)';

  const el = document.getElementById('profit-breakdown');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:9px;">
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border2);"><span style="color:var(--txt2);">Job Value</span><span style="font-weight:700;">${fmtMoney(v)}</span></div>
      ${h ? `<div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:var(--txt2);">Labor (${h}h × $${r}/h)</span><span style="color:var(--red);">-${fmtMoney(labor)}</span></div>` : ''}
      ${m ? `<div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:var(--txt2);">Materials</span><span style="color:var(--red);">-${fmtMoney(m)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:var(--txt2);">Overhead (${oh}%)</span><span style="color:var(--red);">-${fmtMoney(overh)}</span></div>
      ${sub ? `<div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:var(--txt2);">Subs / Helpers</span><span style="color:var(--red);">-${fmtMoney(sub)}</span></div>` : ''}
      ${tr  ? `<div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:var(--txt2);">Travel / Fuel</span><span style="color:var(--red);">-${fmtMoney(tr)}</span></div>` : ''}
      ${pr  ? `<div style="display:flex;justify-content:space-between;padding:5px 0;"><span style="color:var(--txt2);">Permits</span><span style="color:var(--red);">-${fmtMoney(pr)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:13px;background:var(--surface2);border-radius:var(--radius);margin-top:4px;">
        <span style="font-weight:700;font-size:14px;color:var(--txt);">Net Profit</span>
        <span style="font-family:var(--font-display);font-size:28px;font-weight:800;color:${col};">${fmtMoney(net)}</span>
      </div>
      <div style="display:flex;gap:14px;padding-top:2px;">
        <div style="text-align:center;flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;">
          <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Margin</div>
          <div style="font-weight:800;font-size:18px;color:${col};">${marg.toFixed(1)}%</div>
        </div>
        <div style="text-align:center;flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;">
          <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Total Cost</div>
          <div style="font-weight:800;font-size:18px;color:var(--red);">${fmtMoney(total)}</div>
        </div>
        <div style="text-align:center;flex:1;background:var(--surface2);border-radius:var(--radius);padding:10px;">
          <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">$/Hour</div>
          <div style="font-weight:800;font-size:18px;">${h ? '$' + (net/h).toFixed(0) : '—'}</div>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   ESTIMATES
═══════════════════════════════════════════════════════════════ */
function openAddEstimate() {
  openModal('modal-add-estimate');
  _setVal('ae-expiry', new Date(Date.now() + 30*86400000).toISOString().split('T')[0]);
}

function saveEstimate() {
  const v = new Validator([
    { field: 'ae-client', required: true, label: 'Client name' },
    { field: 'ae-type',   required: true, label: 'Job type' },
  ]);
  if (!v.validate()) return;

  const labor = parseFloat(document.getElementById('ae-labor')?.value) || 0;
  const mats  = parseFloat(document.getElementById('ae-materials')?.value) || 0;
  const other = parseFloat(document.getElementById('ae-other')?.value) || 0;
  const ests  = [...store.get('estimates')];
  ests.push({
    id:        `EST-${String(ests.length + 1).padStart(3, '0')}`,
    client:    document.getElementById('ae-client').value.trim(),
    type:      document.getElementById('ae-type').value,
    labor, materials: mats, other,
    total:     labor + mats + other,
    scope:     document.getElementById('ae-scope')?.value ?? '',
    expiry:    document.getElementById('ae-expiry')?.value ?? '',
    status:    'Draft',
    date:      new Date().toISOString().split('T')[0],
  });
  store.set('estimates', ests);
  closeModal('modal-add-estimate');
  toast('Estimate created!', 'success');
}

store.subscribe('estimates', renderEstimates);

function renderEstimates() {
  const tbody = document.getElementById('estimates-tbody');
  if (!tbody) return;
  const ests = store.get('estimates');
  if (!ests.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--txt3);">No estimates yet.</td></tr>'; return; }
  tbody.innerHTML = ests.slice().reverse().map(e => `
    <tr>
      <td style="font-weight:700;">${e.id}</td>
      <td>${esc(e.client)}</td>
      <td style="color:var(--txt2);">${esc(e.type)}</td>
      <td style="font-weight:700;color:#2E9E6B;">${fmtMoney(e.total)}</td>
      <td><span class="badge ${e.status==='Approved'?'badge-green':e.status==='Sent'?'badge-blue':'badge-gray'}">${e.status}</span></td>
      <td style="color:var(--txt2);">${e.date}</td>
      <td><div style="display:flex;gap:5px;">
        ${e.status !== 'Approved' ? `<button class="btn btn-green btn-sm" onclick="approveEst('${e.id}')">Approve</button>` : ''}
        ${e.status === 'Draft'    ? `<button class="btn btn-outline btn-sm" onclick="sendEst('${e.id}')">Send</button>` : ''}
      </div></td>
    </tr>`).join('');
}

function approveEst(id) {
  store.set('estimates', store.get('estimates').map(e => e.id === id ? {...e, status:'Approved'} : e));
  toast('Estimate approved!', 'success');
}
function sendEst(id) {
  store.set('estimates', store.get('estimates').map(e => e.id === id ? {...e, status:'Sent'} : e));
  toast('Estimate marked as sent', 'info');
}

/* ═══════════════════════════════════════════════════════════════
   INVOICES
═══════════════════════════════════════════════════════════════ */
function createInvoiceFromJob(jobId) {
  const j = store.get('jobs').find(x => x.id === jobId);
  if (!j) return;
  const invs = [...store.get('invoices')];
  invs.push({
    id:     `INV-${String(invs.length + 1).padStart(4,'0')}`,
    jobId, client: j.client,
    job:    `${j.type} — ${j.address || ''}`,
    amount: j.value,
    status: 'Draft',
    date:   new Date().toISOString().split('T')[0],
    due:    new Date(Date.now() + 30*86400000).toISOString().split('T')[0],
  });
  store.set('invoices', invs);
  navTo('invoices', null);
  toast(`Invoice created!`, 'success');
}

store.subscribe('invoices', renderInvoices);

function renderInvoices() {
  const tbody = document.getElementById('invoices-tbody');
  if (!tbody) return;
  const invs = store.get('invoices');
  if (!invs.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--txt3);">No invoices yet.</td></tr>'; return; }
  tbody.innerHTML = invs.slice().reverse().map(inv => `
    <tr>
      <td style="font-weight:700;">${inv.id}</td>
      <td>${esc(inv.client)}</td>
      <td style="color:var(--txt2);font-size:12px;">${esc(inv.job)}</td>
      <td style="font-weight:700;color:#2E9E6B;">${fmtMoney(inv.amount)}</td>
      <td><span class="badge ${inv.status==='Paid'?'badge-green':inv.status==='Sent'?'badge-blue':'badge-gray'}">${inv.status}</span></td>
      <td style="color:var(--txt2);">${inv.due}</td>
      <td><div style="display:flex;gap:5px;">
        ${inv.status !== 'Paid' ? `<button class="btn btn-green btn-sm" onclick="markInvPaid('${inv.id}')">Paid</button>` : ''}
        ${inv.status === 'Draft' ? `<button class="btn btn-outline btn-sm" onclick="markInvSent('${inv.id}')">Send</button>` : ''}
      </div></td>
    </tr>`).join('');
}

function markInvPaid(id) {
  store.set('invoices', store.get('invoices').map(i => i.id === id ? {...i, status:'Paid'} : i));
  toast('Invoice marked paid!', 'success');
}
function markInvSent(id) {
  store.set('invoices', store.get('invoices').map(i => i.id === id ? {...i, status:'Sent'} : i));
  toast('Invoice sent', 'info');
}

/* ═══════════════════════════════════════════════════════════════
   CLIENTS
═══════════════════════════════════════════════════════════════ */
function openAddClient() { openModal('modal-add-client'); }

function saveClient() {
  const v = new Validator([
    { field: 'ac-fname', required: true, label: 'First name' },
    { field: 'ac-phone', required: true, label: 'Phone',
      pattern: /[\d\s\-\(\)\+]{7,}/, message: 'Enter a valid phone number.' },
  ]);
  if (!v.validate()) return;

  const clients = [...store.get('clients')];
  clients.push({
    id:      `C${Date.now()}`,
    name:    `${document.getElementById('ac-fname').value} ${document.getElementById('ac-lname')?.value ?? ''}`.trim(),
    phone:   document.getElementById('ac-phone').value,
    email:   document.getElementById('ac-email')?.value ?? '',
    address: document.getElementById('ac-address')?.value ?? '',
    notes:   document.getElementById('ac-notes')?.value ?? '',
  });
  store.set('clients', clients);
  closeModal('modal-add-client');
  toast('Client added!', 'success');
}

store.subscribe('clients', renderClients);
store.subscribe('jobs',    renderClients);

function renderClients() {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  const clients = store.get('clients');
  const jobs    = store.get('jobs');
  if (!clients.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--txt3);">No clients yet.</td></tr>'; return; }
  tbody.innerHTML = clients.map(c => {
    const cJobs = jobs.filter(j => j.client === c.name);
    const ltv   = cJobs.reduce((s, j) => s + (parseFloat(j.value) || 0), 0);
    return `<tr>
      <td style="font-weight:600;">${esc(c.name)}</td>
      <td>${esc(c.phone) || '—'}</td>
      <td style="font-size:12px;color:var(--txt2);">${esc(c.address) || '—'}</td>
      <td>${cJobs.length}</td>
      <td style="font-weight:700;color:#2E9E6B;">${fmtMoney(ltv)}</td>
      <td><button class="btn btn-pri btn-sm" onclick="openAddJob()">+ Job</button></td>
    </tr>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   MATERIALS
═══════════════════════════════════════════════════════════════ */
function openAddMaterial() { openModal('modal-add-material'); }

function saveMaterial() {
  const v = new Validator([
    { field: 'am-item', required: true, label: 'Item name' },
    { field: 'am-qty',  required: true, min: 0.01, label: 'Quantity' },
    { field: 'am-cost', required: true, min: 0,    label: 'Unit cost' },
  ]);
  if (!v.validate()) return;

  const qty  = parseFloat(document.getElementById('am-qty').value) || 1;
  const cost = parseFloat(document.getElementById('am-cost').value) || 0;
  const mats = [...store.get('materials')];
  mats.push({
    id:       `M${Date.now()}`,
    item:     document.getElementById('am-item').value.trim(),
    supplier: document.getElementById('am-supplier')?.value ?? '',
    qty, cost, total: qty * cost,
    job:      document.getElementById('am-job')?.value ?? '',
    date:     new Date().toISOString().split('T')[0],
  });
  store.set('materials', mats);
  closeModal('modal-add-material');
  toast('Material logged!', 'success');
}

store.subscribe('materials', renderMaterials);

function renderMaterials() {
  const tbody = document.getElementById('materials-tbody');
  if (!tbody) return;
  const mats = store.get('materials');
  if (!mats.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--txt3);">No materials logged.</td></tr>'; return; }
  tbody.innerHTML = mats.slice().reverse().map(m =>
    `<tr><td style="font-weight:600;">${esc(m.item)}</td><td>${esc(m.supplier)||'—'}</td><td>${m.qty}</td><td>$${m.cost.toFixed(2)}</td><td style="font-weight:700;">${fmtMoney(m.total)}</td></tr>`
  ).join('');

  // Supplier history
  const histEl = document.getElementById('supplier-history-body');
  if (!histEl) return;
  const byItem = {};
  mats.forEach(m => { if (!byItem[m.item]) byItem[m.item] = []; byItem[m.item].push(m); });
  const multi  = Object.entries(byItem).filter(([, v]) => v.length > 1);
  if (!multi.length) { histEl.innerHTML = '<div style="text-align:center;padding:28px;color:var(--txt3);font-size:13px;">Log the same item from multiple suppliers to build price history.</div>'; return; }
  histEl.innerHTML = multi.map(([item, entries]) => {
    const sorted = entries.slice().sort((a, b) => a.cost - b.cost);
    return `<div style="padding:12px 0;border-bottom:1px solid var(--border2);">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px;">${esc(item)}</div>
      ${sorted.map((e, i) => `<div style="display:flex;justify-content:space-between;font-size:12px;color:${i===0?'#2E9E6B':'var(--txt2)'};padding:2px 0;">${esc(e.supplier)||'Unknown'} <strong>$${e.cost.toFixed(2)}</strong>${i===0?' — Best price':''}</div>`).join('')}
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   CREW
═══════════════════════════════════════════════════════════════ */
function openAddCrew() { openModal('modal-add-crew'); }

function saveCrew() {
  const v = new Validator([
    { field: 'cr-fname',     required: true, label: 'First name' },
    { field: 'cr-pay-rate',  required: true, min: 1, label: 'Pay rate' },
  ]);
  if (!v.validate()) return;

  const crew = [...store.get('crew')];
  crew.push({
    id:      `CR${Date.now()}`,
    name:    `${document.getElementById('cr-fname').value} ${document.getElementById('cr-lname')?.value??''}`.trim(),
    phone:   document.getElementById('cr-phone')?.value ?? '',
    role:    document.getElementById('cr-role')?.value ?? '',
    payType: document.getElementById('cr-pay-type')?.value ?? 'Per Job',
    payRate: document.getElementById('cr-pay-rate').value,
    status:  'Available',
  });
  store.set('crew', crew);
  closeModal('modal-add-crew');
  toast('Crew member added!', 'success');
}

store.subscribe('crew', renderCrew);

function renderCrew() {
  const crew  = store.get('crew');
  const avail = crew.filter(c => c.status === 'Available');
  const onJob = crew.filter(c => c.status === 'On Job');
  const ka    = document.getElementById('kanban-avail');
  const ko    = document.getElementById('kanban-onjob');
  if (ka) ka.innerHTML = avail.length
    ? avail.map(c => `<div class="kanban-card"><div class="kanban-card-name">${esc(c.name)}</div><div class="kanban-card-info">${c.role||''} · ${c.payType}: ${c.payRate}</div></div>`).join('')
    : '<div style="text-align:center;padding:16px;color:var(--txt3);font-size:13px;">No available crew</div>';
  if (ko) ko.innerHTML = onJob.length
    ? onJob.map(c => `<div class="kanban-card"><div class="kanban-card-name">${esc(c.name)}</div><div class="kanban-card-info">On job</div></div>`).join('')
    : '<div style="text-align:center;padding:16px;color:var(--txt3);font-size:13px;">No active assignments</div>';
}

/* ═══════════════════════════════════════════════════════════════
   CHECKLISTS
═══════════════════════════════════════════════════════════════ */
function openAddChecklist() { openModal('modal-add-checklist'); }

function saveChecklist() {
  const v = new Validator([{ field: 'cl-name', required: true, label: 'Checklist name' }]);
  if (!v.validate()) return;

  const items = document.getElementById('cl-items')?.value.split('\n').filter(x => x.trim()) ?? [];
  const lists = [...store.get('checklists')];
  lists.push({
    id:    `CL${Date.now()}`,
    name:  document.getElementById('cl-name').value.trim(),
    trade: document.getElementById('cl-trade')?.value ?? 'General',
    type:  document.getElementById('cl-type')?.value  ?? 'Pre-Job',
    items,
    created: new Date().toISOString().split('T')[0],
  });
  store.set('checklists', lists);
  closeModal('modal-add-checklist');
  toast('Checklist saved!', 'success');
}

store.subscribe('checklists', renderChecklists);

function renderChecklists() {
  const el    = document.getElementById('checklist-body');
  if (!el) return;
  const lists = store.get('checklists');
  if (!lists.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--txt3);"><div style="font-size:14px;font-weight:600;margin-bottom:6px;">No checklists yet</div><button class="btn btn-pri" onclick="openAddChecklist()">+ Create Checklist</button></div>';
    return;
  }
  el.innerHTML = lists.map(cl => `
    <div style="padding:16px;border-bottom:1px solid var(--border2);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div>
          <div style="font-weight:700;font-size:14px;">${esc(cl.name)}</div>
          <div style="font-size:12px;color:var(--txt3);">${cl.trade} · ${cl.type} · ${cl.items.length} items</div>
        </div>
        <span class="badge badge-orange">${cl.type}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${cl.items.slice(0,4).map(item => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--txt2);cursor:pointer;"><input type="checkbox" style="accent-color:var(--orange);"> ${esc(item)}</label>`).join('')}
        ${cl.items.length > 4 ? `<div style="font-size:12px;color:var(--txt3);">+${cl.items.length-4} more items</div>` : ''}
      </div>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════════════
   OVERHEAD ANALYZER
═══════════════════════════════════════════════════════════════ */
function calcOverhead() {
  const truck = parseFloat(document.getElementById('oh-truck')?.value)  || 0;
  const ins   = parseFloat(document.getElementById('oh-ins')?.value)    || 0;
  const fuel  = parseFloat(document.getElementById('oh-fuel')?.value)   || 0;
  const tools = parseFloat(document.getElementById('oh-tools')?.value)  || 0;
  const phone = parseFloat(document.getElementById('oh-phone')?.value)  || 0;
  const other = parseFloat(document.getElementById('oh-other')?.value)  || 0;
  const hours = parseFloat(document.getElementById('oh-hours')?.value)  || 140;
  const total = truck + ins + fuel + tools + phone + other;
  if (!total) return;

  const perHour    = total / hours;
  const minRate    = perHour * 1.3;
  const minDayRate = perHour * 8 * 1.3;

  const el = document.getElementById('overhead-result');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border2);"><span style="color:var(--txt2);">Monthly Overhead</span><span style="font-weight:700;color:var(--red);">${fmtMoney(total)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border2);"><span style="color:var(--txt2);">Billable Hours / Month</span><span style="font-weight:700;">${hours}h</span></div>
      <div style="padding:13px;background:var(--surface2);border-radius:var(--radius);">
        <div style="font-size:11px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Overhead Cost Per Hour</div>
        <div style="font-family:var(--font-display);font-size:30px;font-weight:800;color:var(--red);">$${perHour.toFixed(2)}</div>
      </div>
      <div style="padding:13px;background:var(--orange-pale);border-radius:var(--radius);">
        <div style="font-size:11px;color:var(--orange-d);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Min Hourly Rate (30% margin)</div>
        <div style="font-family:var(--font-display);font-size:30px;font-weight:800;color:var(--orange);">$${minRate.toFixed(2)}/hr</div>
      </div>
      <div style="padding:13px;background:rgba(46,158,107,.08);border-radius:var(--radius);">
        <div style="font-size:11px;color:#1a6b4a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Min 8-Hour Day Rate</div>
        <div style="font-family:var(--font-display);font-size:30px;font-weight:800;color:#2E9E6B;">${fmtMoney(minDayRate)}</div>
      </div>
      <p style="font-size:12px;color:var(--txt3);line-height:1.6;">Any job priced below your minimum rate means you're working for free or losing money.</p>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   GOALS
═══════════════════════════════════════════════════════════════ */
function saveGoals() {
  const v = new Validator([
    { field: 'goal-rev-input',  required: true, min: 1, label: 'Revenue goal' },
    { field: 'goal-jobs-input', required: true, min: 1, label: 'Job count goal' },
  ]);
  if (!v.validate()) return;

  store.patch('profile', {
    goal:    parseFloat(document.getElementById('goal-rev-input').value)  || 8000,
    jobGoal: parseFloat(document.getElementById('goal-jobs-input').value) || 15,
  });
  toast('Goals saved!', 'success');
}

store.subscribe('jobs',    renderGoals);
store.subscribe('profile', renderGoals);

function renderGoals() {
  const now    = new Date();
  const jobs   = store.get('jobs');
  const p      = store.get('profile');
  const month  = jobs.filter(j => {
    const d = new Date(j.date || j.created || now);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const rev    = month.reduce((s, j) => s + (parseFloat(j.value) || 0), 0);
  const goal   = p.goal    || 8000;
  const jGoal  = p.jobGoal || 15;
  const rPct   = Math.min(100, Math.round(rev / goal * 100));
  const jPct   = Math.min(100, Math.round(month.length / jGoal * 100));

  _setText('goals-rev-pct',  `${rPct}%`);
  _setText('goals-job-pct',  `${jPct}%`);
  _setStyle('goals-rev-bar', 'width', `${rPct}%`);
  _setStyle('goals-job-bar', 'width', `${jPct}%`);
  _setVal('goal-rev-input',  String(goal));
  _setVal('goal-jobs-input', String(jGoal));

  const lb = document.getElementById('leaderboard-body');
  if (!lb) return;
  const crew = store.get('crew');
  lb.innerHTML = crew.length
    ? crew.map((c, i) => `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--border2);">
        <div style="font-family:var(--font-display);font-size:18px;font-weight:800;color:var(--orange);width:22px;">${i+1}</div>
        <div style="flex:1;font-weight:600;font-size:13px;">${esc(c.name)}</div>
        <div style="font-size:12px;color:var(--txt3);">$0 · 0 jobs</div>
      </div>`).join('')
    : '<div style="text-align:center;padding:28px;color:var(--txt3);font-size:13px;">Add crew members to see leaderboard.</div>';
}

/* ═══════════════════════════════════════════════════════════════
   CALENDAR
═══════════════════════════════════════════════════════════════ */
store.subscribe('jobs', renderCalendar);

function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const titleEl = document.getElementById('cal-title');
  if (titleEl) titleEl.textContent = `${months[_calMonth]} ${_calYear}`;

  const first = new Date(_calYear, _calMonth, 1).getDay();
  const days  = new Date(_calYear, _calMonth + 1, 0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const jobs  = store.get('jobs');
  const today = new Date().toISOString().split('T')[0];

  let html = `<div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--border);">`;
  dayNames.forEach(d => html += `<div style="padding:9px;text-align:center;font-size:10px;font-weight:700;color:var(--txt3);text-transform:uppercase;">${d}</div>`);
  html += '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);">';
  for (let i = 0; i < first; i++) html += `<div style="padding:8px;border-right:1px solid var(--border2);border-bottom:1px solid var(--border2);min-height:76px;"></div>`;
  for (let day = 1; day <= days; day++) {
    const date    = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayJobs = jobs.filter(j => j.date === date);
    const isToday = date === today;
    html += `<div style="padding:7px;border-right:1px solid var(--border2);border-bottom:1px solid var(--border2);min-height:76px;${isToday?'background:rgba(232,109,42,.06);':''}">
      <div style="font-size:12px;font-weight:${isToday?'700':'400'};color:${isToday?'var(--orange)':'var(--txt)'};margin-bottom:3px;">${day}</div>
      ${dayJobs.map(j => `<div style="font-size:10px;background:rgba(232,109,42,.12);color:var(--orange);border-radius:3px;padding:2px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(j.client||'')}</div>`).join('')}
    </div>`;
  }
  html += '</div>';
  const body = document.getElementById('cal-body');
  if (body) body.innerHTML = html;
}

function calPrev() { if (_calMonth === 0) { _calMonth = 11; _calYear--; } else _calMonth--; renderCalendar(); }
function calNext() { if (_calMonth === 11) { _calMonth = 0; _calYear++; } else _calMonth++; renderCalendar(); }

/* ═══════════════════════════════════════════════════════════════
   GPS TRACKING
═══════════════════════════════════════════════════════════════ */
function initGPS() {
  renderGPSCrewList();
  setTimeout(() => {
    if (typeof L === 'undefined') {
      const mapEl = document.getElementById('gps-map');
      if (mapEl) mapEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--txt3);">Map requires internet connection.</div>';
      return;
    }
    const locs = Object.values(_gpsLocs);
    if (locs.length && !_gpsMap) _initLeaflet(locs[0].lat, locs[0].lng);
    else if (!_gpsMap)           _initLeaflet(32.7767, -96.7970);
    locs.forEach(_plotMarker);
  }, 100);
}

function _initLeaflet(lat, lng) {
  const mapEl = document.getElementById('gps-map');
  if (!mapEl || _gpsMap) return;
  mapEl.innerHTML = '<div id="gps-map-leaflet" style="height:360px;"></div>';
  _gpsMap = L.map('gps-map-leaflet').setView([lat, lng], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 18,
  }).addTo(_gpsMap);
}

function _plotMarker(loc) {
  if (!_gpsMap) return;
  const abbr = (loc.name || '?').split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
  const icon = L.divIcon({
    html: `<div style="background:#E86D2A;color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);">${abbr}</div>`,
    className: '', iconSize: [32,32], iconAnchor: [16,16],
  });
  if (_gpsMarkers[loc.id]) {
    _gpsMarkers[loc.id].setLatLng([loc.lat, loc.lng]);
  } else {
    _gpsMarkers[loc.id] = L.marker([loc.lat, loc.lng], { icon })
      .addTo(_gpsMap)
      .bindPopup(`<strong>${loc.name||'Unknown'}</strong><br><small>Updated: ${new Date(loc.time).toLocaleTimeString()}</small>`);
  }
}

function shareMyLocation() {
  if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
  toast('Getting your location...', 'info');
  navigator.geolocation.getCurrentPosition(pos => {
    const id  = _user?.id || 'self';
    const loc = {
      id, name: _user?.name || 'Unknown',
      lat:  pos.coords.latitude,
      lng:  pos.coords.longitude,
      address: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
      time: Date.now(), active: true,
    };
    _gpsLocs[id] = loc;
    localStorage.setItem('cso_field_gps', JSON.stringify(_gpsLocs));
    if (!_gpsMap) _initLeaflet(loc.lat, loc.lng);
    _plotMarker(loc);
    _gpsMap?.setView([loc.lat, loc.lng], 13);
    renderGPSCrewList();
    _setText('gps-status-badge', 'Live');
    document.getElementById('gps-status-badge')?.classList.replace('badge-gray','badge-green');
    toast(`Location shared`, 'success');
    if (_gpsWatchId) navigator.geolocation.clearWatch(_gpsWatchId);
    _gpsWatchId = navigator.geolocation.watchPosition(p => {
      loc.lat = p.coords.latitude; loc.lng = p.coords.longitude; loc.time = Date.now();
      _gpsLocs[id] = loc;
      localStorage.setItem('cso_field_gps', JSON.stringify(_gpsLocs));
      _plotMarker(loc); renderGPSCrewList();
    }, null, { maximumAge: 60000, timeout: 10000 });
  }, () => toast('Location access denied. Allow location in browser settings.', 'error'));
}

function renderGPSCrewList() {
  const el    = document.getElementById('gps-crew-list');
  if (!el) return;
  const locs  = Object.values(_gpsLocs);
  const crew  = store.get('crew');
  const noLoc = crew.filter(c => !_gpsLocs[c.id]);
  if (!locs.length && !noLoc.length) {
    el.innerHTML = '<div style="text-align:center;padding:28px;color:var(--txt3);font-size:13px;">No crew locations shared yet.</div>';
    return;
  }
  const active = Date.now() - 300000;
  el.innerHTML = [
    ...locs.map(loc => `
      <div class="gps-crew-item">
        <div class="gps-dot ${loc.time > active ? '' : 'inactive'}"></div>
        <div style="flex:1;">
          <div class="gps-crew-name">${esc(loc.name)}</div>
          <div class="gps-crew-coords">${loc.address}</div>
          <div class="gps-crew-time">Updated ${timeAgo(loc.time)}</div>
        </div>
        <span class="badge ${loc.time > active ? 'badge-green' : 'badge-gray'}">${loc.time > active ? 'Active' : 'Inactive'}</span>
      </div>`),
    ...noLoc.map(c => `
      <div class="gps-crew-item">
        <div class="gps-dot inactive"></div>
        <div style="flex:1;"><div class="gps-crew-name">${esc(c.name)}</div><div class="gps-crew-coords">Location not shared</div></div>
        <span class="badge badge-gray">Offline</span>
      </div>`),
  ].join('');
}

/* ═══════════════════════════════════════════════════════════════
   ONLINE BOOKING
═══════════════════════════════════════════════════════════════ */
store.subscribe('bookingRequests', renderBookingRequests);

function renderBookingPage() {
  const bs = store.get('bookingSettings') || {};
  if (bs.name)     _setVal('bk-name',     bs.name);
  if (bs.services) _setVal('bk-services', bs.services);
  if (bs.area)     _setVal('bk-area',     bs.area);
  if (bs.response) _setVal('bk-response', bs.response);
  _updateBookingPreview();
  renderBookingRequests();
}

function saveBookingSettings() {
  const v = new Validator([
    { field: 'bk-name', required: true, label: 'Business name' },
  ]);
  if (!v.validate()) return;
  store.set('bookingSettings', {
    name:     document.getElementById('bk-name')?.value ?? '',
    services: document.getElementById('bk-services')?.value ?? '',
    area:     document.getElementById('bk-area')?.value ?? '',
    response: document.getElementById('bk-response')?.value ?? '',
  });
  _updateBookingPreview();
  toast('Booking page updated!', 'success');
}

function _updateBookingPreview() {
  const bs = store.get('bookingSettings') || {};
  const name     = document.getElementById('bk-name')?.value    || bs.name    || 'Your Company';
  const area     = document.getElementById('bk-area')?.value    || bs.area    || 'Service Area';
  const response = document.getElementById('bk-response')?.value|| bs.response|| 'We respond within 2 business hours';
  const services = document.getElementById('bk-services')?.value|| bs.services|| '';
  _setText('preview-name',     name);
  _setText('preview-area',     area);
  _setText('preview-response', response);
  const svc = document.getElementById('preview-services');
  if (svc && services) {
    const lines = services.split('\n').filter(x => x.trim());
    svc.innerHTML = '<option>Select a service...</option>' + lines.map(s => `<option>${esc(s)}</option>`).join('');
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-');
  _setText('booking-link-display', `csofield.app/book/${slug}`);
}

function copyBookingLink() {
  const link = document.getElementById('booking-link-display')?.textContent ?? '';
  navigator.clipboard?.writeText(`https://${link}`)
    .then(() => toast('Booking link copied!', 'success'))
    .catch(() => toast(`Link: https://${link}`, 'info'));
}

function renderBookingRequests() {
  const requests = store.get('bookingRequests') || [];
  const tbody    = document.getElementById('booking-requests-tbody');
  const badge    = document.getElementById('booking-count-badge');
  const pending  = requests.filter(r => r.status === 'Pending').length;
  if (badge) badge.textContent = `${pending} pending`;
  if (!tbody) return;
  if (!requests.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--txt3);">No booking requests yet.</td></tr>';
    return;
  }
  tbody.innerHTML = requests.slice().reverse().map(r => `
    <tr>
      <td style="font-weight:600;">${esc(r.name)}</td>
      <td>${esc(r.phone)}</td>
      <td>${esc(r.service)}</td>
      <td style="font-size:12px;color:var(--txt2);">${esc(r.address)}</td>
      <td style="font-size:12px;color:var(--txt2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.message||'')}</td>
      <td style="font-size:12px;color:var(--txt3);">${new Date(r.created).toLocaleDateString()}</td>
      <td>
        <div style="display:flex;gap:6px;">
          ${r.status === 'Pending' ? `<button class="btn btn-pri btn-sm" onclick="convertBookingToJob('${r.id}')">+ Job</button>` : ''}
          <span class="badge ${r.status==='Pending'?'badge-orange':'badge-green'}">${r.status}</span>
        </div>
      </td>
    </tr>`).join('');
}

function convertBookingToJob(id) {
  const requests = store.get('bookingRequests') || [];
  const r = requests.find(x => x.id === id);
  if (!r) return;
  _editJobId = null;
  _setVal('aj-client',  r.name);
  _setVal('aj-address', r.address);
  _setVal('aj-notes',   `Booked online: ${r.service}. ${r.message||''}`);
  _setVal('aj-status',  'Scheduled');
  _setVal('aj-date',    new Date().toISOString().split('T')[0]);
  store.set('bookingRequests', requests.map(x => x.id === id ? {...x, status:'Converted'} : x));
  navTo('jobs', null);
  openModal('modal-add-job');
  toast('Booking converted to job!', 'success');
}

function simulateBookingRequest() {
  const bs       = store.get('bookingSettings') || {};
  const services = (bs.services || 'Plumbing,Electrical,HVAC').split('\n').filter(x => x.trim());
  const demos    = [
    { name:'Carlos Rivera',  phone:'(214) 555-3421', address:'4521 Oak Lane, Dallas TX' },
    { name:'Patricia Moore', phone:'(972) 555-8820', address:'312 Elm St, Irving TX' },
    { name:'James Wilson',   phone:'(469) 555-1199', address:'789 Pine Rd, Garland TX' },
  ];
  const demo = demos[Math.floor(Math.random() * demos.length)];
  const req  = {
    id:      `BR${Date.now()}`,
    ...demo,
    service: services[Math.floor(Math.random() * services.length)] || 'General Service',
    message: 'Please call before arriving.',
    status:  'Pending',
    created: new Date().toISOString(),
  };
  store.set('bookingRequests', [...(store.get('bookingRequests')||[]), req]);
  toast(`New booking from ${req.name}!`, 'success');
}

/* ═══════════════════════════════════════════════════════════════
   AI ASSISTANT  (Claude API via Anthropic)
═══════════════════════════════════════════════════════════════ */
/**
 * Call the Anthropic messages API.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function _callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system:     'You are CSO Field AI, a specialized assistant for independent contractors and trade professionals. Be concise, practical, and specific to the trades industry.',
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text ?? 'No response.';
}

/** Helper: set AI response element */
function _aiShow(id, html) {
  const el = document.getElementById(id);
  if (el) { el.style.display = ''; el.innerHTML = html.replace(/\n/g,'<br>'); }
}

async function aiEstimate() {
  const input = document.getElementById('ai-est-input')?.value.trim();
  if (!input) { toast('Describe the job first', 'error'); return; }
  _aiShow('ai-est-result', 'Writing estimate...');
  try {
    const t = await _callClaude(`Write a professional line-item contractor estimate for:\n${input}\n\nFormat:\nLABOR: [hours] hours × $[rate] = $[total]\nMATERIALS: [itemised list]\nMISC: [other costs]\nTOTAL: $[amount]\n\nInclude a brief scope of work paragraph.`);
    _aiShow('ai-est-result', t);
  } catch (_) { _aiShow('ai-est-result', 'AI unavailable. Check API configuration.'); }
}

async function aiMessage() {
  const type   = document.getElementById('ai-msg-type')?.value ?? '';
  const client = document.getElementById('ai-msg-client')?.value || '[Client Name]';
  _aiShow('ai-msg-result', 'Drafting message...');
  try {
    const t = await _callClaude(`Write a professional, friendly ${type} text message or email from a contractor to client named ${client}. Keep it brief (2-4 sentences), professional, action-oriented. Company: ${store.get('profile').company || '[Your Company]'}`);
    _aiShow('ai-msg-result', t);
  } catch (_) { _aiShow('ai-msg-result', 'AI unavailable.'); }
}

async function aiMaterials() {
  const input = document.getElementById('ai-mat-input')?.value.trim();
  if (!input) { toast('Describe the job first', 'error'); return; }
  _aiShow('ai-mat-result', 'Estimating materials...');
  try {
    const t = await _callClaude(`Estimate materials for this job:\n${input}\n\nList as: ITEM | QUANTITY | EST. UNIT COST | TOTAL\nUse current realistic pricing. Note where to source each item.`);
    _aiShow('ai-mat-result', t);
  } catch (_) { _aiShow('ai-mat-result', 'AI unavailable.'); }
}

async function aiRoute() {
  const input = document.getElementById('ai-route-input')?.value.trim();
  if (!input) { toast('Enter your jobs for today', 'error'); return; }
  _aiShow('ai-route-result', 'Optimizing route...');
  try {
    const t = await _callClaude(`A contractor has these jobs today:\n${input}\n\nSuggest the most fuel-efficient order, estimate total drive distance, and note any traffic patterns to consider.`);
    _aiShow('ai-route-result', t);
  } catch (_) { _aiShow('ai-route-result', 'AI unavailable.'); }
}

/* ═══════════════════════════════════════════════════════════════
   DOM MICRO-HELPERS
═══════════════════════════════════════════════════════════════ */
const _setText  = (id, text)       => { const el = document.getElementById(id); if (el) el.textContent = text; };
const _setVal   = (id, val)        => { const el = document.getElementById(id); if (el) el.value = val; };
const _setStyle = (id, prop, val)  => { const el = document.getElementById(id); if (el) el.style[prop] = val; };

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Restore theme
  const savedTheme = localStorage.getItem('cso_field_theme');
  const sysPref    = window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', savedTheme || sysPref);
  const themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) themeBtn.textContent = (savedTheme || sysPref) === 'dark' ? 'Light' : 'Dark';

  // Seed demo data if first launch
  if (!store.get('jobs').length && !store.get('onboarded')) {
    store.set('jobs', [
      { id:'J001', client:'Robert Martinez', type:'Plumbing',  address:'1425 Oak Ln, Dallas TX',   value:1800, hours:6,  status:'Paid',        date:'2025-05-01', netProfit:1170, laborCost:450, created:'2025-05-01T08:00:00Z' },
      { id:'J002', client:'Sarah Thompson',  type:'Electrical',address:'3820 Elm St, Irving TX',   value:2400, hours:8,  status:'In Progress', date:'2025-05-04', netProfit:1560, laborCost:600, created:'2025-05-04T07:00:00Z' },
      { id:'J003', client:'David Chen',      type:'HVAC',      address:'560 Pine Ave, Garland TX', value:3200, hours:10, status:'Scheduled',   date:'2025-05-07', netProfit:2080, laborCost:750, created:'2025-05-03T09:00:00Z' },
    ]);
  }
});
