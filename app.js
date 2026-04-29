/* =====================================================================
   FAMILY DOCUMENTS — Vanilla JS App
   ---------------------------------------------------------------------
   Module map:
     CONFIG         – API keys, scopes, defaults
     State          – in-memory app state
     Storage        – localStorage helpers (cache categories & metadata)
     Toast          – notification toasts
     Loader         – global activity overlay
     Sheets         – iOS-style bottom sheet helpers
     Auth           – Google Identity Services (token client) sign-in
     Drive          – Google Drive REST v3 (folders, list, upload, delete)
     UI             – rendering for each screen
     Modals         – document viewer
     PullToRefresh  – touch-driven refresh on dashboard / category screens
     Theme          – light / dark / system theme
     PWA            – service-worker registration
     App            – top-level init + event wiring
   ===================================================================== */

(function () {
  'use strict';

  // ===================================================================
  // CONFIG
  // -------------------------------------------------------------------
  // ⚠️  IMPORTANT: Replace these placeholder values with your own
  //     credentials from Google Cloud Console — see README.md.
  // ===================================================================
  const CONFIG = {
    // OAuth 2.0 Web Client ID
    GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

    // API key (used by gapi.client + Picker)
    GOOGLE_API_KEY: 'YOUR_GOOGLE_API_KEY',

    // App ID (Google Cloud project number) — used by Picker
    GOOGLE_APP_ID: 'YOUR_GOOGLE_APP_ID',

    // Scope — drive.file ONLY: per-file access for files the app creates
    // or the user explicitly opens via the Picker. We never read other
    // files in the user's Drive.
    SCOPES: 'https://www.googleapis.com/auth/drive.file',

    // Drive discovery doc for gapi.client
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',

    // Root folder created in user's Drive
    ROOT_FOLDER_NAME: 'Family Documents Manager',

    // Default seed categories (created on first sign-in)
    DEFAULT_CATEGORIES: [
      { name: 'Car Documents',   icon: '🚗', color: '#FF3B30' },
      { name: 'Arnona',          icon: '🏛️', color: '#FF9500' },
      { name: 'Water',           icon: '💧', color: '#5AC8FA' },
      { name: 'Electricity',     icon: '⚡', color: '#FFCC00' },
      { name: 'Insurance',       icon: '🛡️', color: '#5856D6' },
      { name: 'Kids Documents',  icon: '🎒', color: '#FF2D55' },
      { name: 'Medical',         icon: '🏥', color: '#34C759' },
      { name: 'Home Maintenance',icon: '🛠️', color: '#AF52DE' },
      { name: 'Others',          icon: '📁', color: '#8E8E93' }
    ],

    // Available icons / colors when adding a custom category
    ICON_OPTIONS: ['📁','🚗','🏛️','💧','⚡','🛡️','🎒','🏥','🛠️','📄','🏠','💼','🐾','✈️','🎓','💳','📷','🎁'],
    COLOR_OPTIONS: ['#FF3B30','#FF9500','#FFCC00','#34C759','#00C7BE','#5AC8FA','#007AFF','#5856D6','#AF52DE','#FF2D55','#A2845E','#8E8E93'],

    // Cache TTL for category list / file metadata (ms)
    CACHE_TTL: 5 * 60 * 1000
  };

  // ===================================================================
  // STATE
  // ===================================================================
  const State = {
    user: null,                 // { email, name, picture }
    accessToken: null,
    tokenExpiresAt: 0,
    rootFolderId: null,
    categories: [],             // [{ id, name, icon, color, folderId, count }]
    currentCategoryId: null,
    documents: {},              // { [categoryId]: [files] }
    currentFilter: { type: 'all', search: '' },
    dashboardSearch: '',
    pickerLoaded: false,
    gapiReady: false,
    gisReady: false,
    isInitialized: false
  };

  // ===================================================================
  // STORAGE — small wrapper over localStorage for caching
  // ===================================================================
  const Storage = {
    KEY_PREFIX: 'fdm_',
    get(key) {
      try {
        const raw = localStorage.getItem(this.KEY_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(this.KEY_PREFIX + key, JSON.stringify(value)); } catch {}
    },
    remove(key) {
      try { localStorage.removeItem(this.KEY_PREFIX + key); } catch {}
    },
    setCache(key, data) { this.set(key, { data, ts: Date.now() }); },
    getCache(key, ttl = CONFIG.CACHE_TTL) {
      const cached = this.get(key);
      if (!cached || !cached.ts) return null;
      if (Date.now() - cached.ts > ttl) return null;
      return cached.data;
    }
  };

  // ===================================================================
  // TOAST
  // ===================================================================
  const Toast = {
    el: null,
    init() { this.el = document.getElementById('toast-container'); },
    show(message, type = 'info', duration = 2400) {
      if (!this.el) this.init();
      const t = document.createElement('div');
      t.className = 'toast' + (type ? ' ' + type : '');
      const icon = { success: '✓', error: '⚠', info: 'ℹ' }[type] || '';
      t.innerHTML = (icon ? `<span class="toast-icon">${icon}</span>` : '') + escapeHtml(message);
      this.el.appendChild(t);
      // Light haptic via Vibration API where supported
      if (type === 'success' && navigator.vibrate) navigator.vibrate(8);
      if (type === 'error' && navigator.vibrate) navigator.vibrate([10, 40, 10]);
      setTimeout(() => {
        t.classList.add('is-leaving');
        setTimeout(() => t.remove(), 260);
      }, duration);
    }
  };

  // ===================================================================
  // LOADER
  // ===================================================================
  const Loader = {
    el: null, textEl: null, count: 0,
    init() {
      this.el = document.getElementById('loader');
      this.textEl = document.getElementById('loader-text');
    },
    show(text = 'Loading…') {
      if (!this.el) this.init();
      this.count++;
      this.textEl.textContent = text;
      this.el.hidden = false;
    },
    hide() {
      this.count = Math.max(0, this.count - 1);
      if (this.count === 0 && this.el) this.el.hidden = true;
    }
  };

  // ===================================================================
  // SHEETS — iOS-style bottom sheet helpers
  // ===================================================================
  const Sheets = {
    open(id) {
      const sheet = document.getElementById(id);
      if (!sheet) return;
      sheet.hidden = false;
      // Force reflow then animate
      void sheet.offsetWidth;
      sheet.dataset.open = 'true';
      // Lock background scroll
      document.body.style.overflow = 'hidden';
      if (navigator.vibrate) navigator.vibrate(6);
    },
    close(id) {
      const sheet = document.getElementById(id);
      if (!sheet) return;
      sheet.dataset.open = 'false';
      setTimeout(() => {
        sheet.hidden = true;
        document.body.style.overflow = '';
      }, 360);
    },
    init() {
      // Backdrop / cancel buttons
      document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => this.close(btn.dataset.close));
      });
    }
  };

  // ===================================================================
  // AUTH — Google Identity Services token client
  // ===================================================================
  const Auth = {
    tokenClient: null,

    // Wait for both gsi/client and gapi to load
    async waitForLibs() {
      await new Promise(resolve => {
        const check = () => {
          if (window.google && window.google.accounts && window.gapi) resolve();
          else setTimeout(check, 80);
        };
        check();
      });
      // Initialize gapi.client for Drive
      await new Promise((resolve, reject) => {
        gapi.load('client', { callback: resolve, onerror: reject });
      });
      await gapi.client.init({
        apiKey: CONFIG.GOOGLE_API_KEY,
        discoveryDocs: [CONFIG.DISCOVERY_DOC]
      });
      State.gapiReady = true;

      // Initialize the token client (no callback yet — set per-request)
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: () => {} // overridden per call
      });
      State.gisReady = true;
    },

    // Request a fresh access token. If `prompt=''` (silent) the user is
    // not re-prompted when they already granted consent.
    requestToken(promptUser = false) {
      return new Promise((resolve, reject) => {
        if (!this.tokenClient) return reject(new Error('Auth not initialized'));
        this.tokenClient.callback = (resp) => {
          if (resp.error) return reject(new Error(resp.error));
          State.accessToken = resp.access_token;
          // expires_in seconds
          State.tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
          gapi.client.setToken({ access_token: resp.access_token });
          resolve(resp);
        };
        this.tokenClient.requestAccessToken({ prompt: promptUser ? 'consent' : '' });
      });
    },

    // Ensure we have a valid token, refresh silently if expired
    async ensureToken() {
      if (State.accessToken && Date.now() < State.tokenExpiresAt) return State.accessToken;
      await this.requestToken(false);
      return State.accessToken;
    },

    // Fetch the user's profile (name/email/picture) using the userinfo endpoint
    async fetchUserInfo() {
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: 'Bearer ' + State.accessToken }
        });
        if (!res.ok) return null;
        return await res.json();
      } catch { return null; }
    },

    // Sign out — revoke token and clear cache
    async signOut() {
      if (State.accessToken && google?.accounts?.oauth2) {
        try { google.accounts.oauth2.revoke(State.accessToken, () => {}); } catch {}
      }
      State.accessToken = null;
      State.tokenExpiresAt = 0;
      State.user = null;
      State.rootFolderId = null;
      State.categories = [];
      State.documents = {};
      // Clear cache (keep theme preference)
      Storage.remove('rootFolderId');
      Storage.remove('categories');
      Storage.remove('user');
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith(Storage.KEY_PREFIX + 'docs_')) localStorage.removeItem(k);
      });
      // Reset UI
      document.getElementById('app-shell').hidden = true;
      document.getElementById('screen-login').classList.add('is-active');
      Toast.show('Signed out', 'success');
    }
  };

  // ===================================================================
  // DRIVE — REST v3 helpers
  // ===================================================================
  const Drive = {
    // Find the app's root folder by name; create if missing.
    async ensureRootFolder() {
      if (State.rootFolderId) return State.rootFolderId;
      const cached = Storage.get('rootFolderId');
      if (cached) {
        // Verify it still exists
        try {
          await this._req(`/files/${cached}?fields=id,trashed`);
          State.rootFolderId = cached;
          return cached;
        } catch { /* fall through */ }
      }
      // Search for it
      const q = encodeURIComponent(
        `name='${CONFIG.ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
      const search = await this._req(`/files?q=${q}&fields=files(id,name)&spaces=drive`);
      if (search.files && search.files.length > 0) {
        State.rootFolderId = search.files[0].id;
      } else {
        // Create it
        const folder = await this._req('/files?fields=id,name', {
          method: 'POST',
          body: JSON.stringify({
            name: CONFIG.ROOT_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        State.rootFolderId = folder.id;
      }
      Storage.set('rootFolderId', State.rootFolderId);
      return State.rootFolderId;
    },

    // List subfolders inside the root → categories
    async listCategoryFolders() {
      const root = await this.ensureRootFolder();
      const q = encodeURIComponent(
        `'${root}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
      const res = await this._req(
        `/files?q=${q}&fields=files(id,name,description,modifiedTime)&pageSize=100`
      );
      return res.files || [];
    },

    // Create a new category subfolder. We stash the icon/color in
    // `description` as JSON so it survives across devices.
    async createCategoryFolder(name, icon, color) {
      const root = await this.ensureRootFolder();
      const meta = JSON.stringify({ icon, color });
      return await this._req('/files?fields=id,name,description', {
        method: 'POST',
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [root],
          description: meta
        })
      });
    },

    async renameCategoryFolder(folderId, name, icon, color) {
      const meta = JSON.stringify({ icon, color });
      return await this._req(`/files/${folderId}?fields=id,name,description`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description: meta })
      });
    },

    // Trash a category folder (and its contents).
    async deleteCategoryFolder(folderId) {
      return await this._req(`/files/${folderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ trashed: true })
      });
    },

    // List files inside a category folder.
    async listFiles(categoryFolderId) {
      const q = encodeURIComponent(
        `'${categoryFolderId}' in parents and trashed=false ` +
        `and (mimeType='application/pdf' or mimeType contains 'image/')`
      );
      const fields = 'files(id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,iconLink,webViewLink),nextPageToken';
      let all = [];
      let pageToken = null;
      do {
        const url = `/files?q=${q}&fields=${encodeURIComponent(fields)}&pageSize=100` +
                    (pageToken ? `&pageToken=${pageToken}` : '');
        const res = await this._req(url);
        all = all.concat(res.files || []);
        pageToken = res.nextPageToken;
      } while (pageToken);
      return all;
    },

    // Upload a file (multipart). Returns the new file metadata.
    async uploadFile(file, categoryFolderId, onProgress) {
      const metadata = {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        parents: [categoryFolderId]
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', file);

      const url = 'https://www.googleapis.com/upload/drive/v3/files'
        + '?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink';

      // We use XHR for progress events
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', 'Bearer ' + State.accessToken);
        xhr.upload.addEventListener('progress', (evt) => {
          if (onProgress && evt.lengthComputable) onProgress(evt.loaded / evt.total);
        });
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
          } else { reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`)); }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(form);
      });
    },

    // Trash a file
    async deleteFile(fileId) {
      return await this._req(`/files/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ trashed: true })
      });
    },

    // Download file content as Blob (for viewing PDFs / images in-app)
    async downloadFileBlob(fileId) {
      await Auth.ensureToken();
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: 'Bearer ' + State.accessToken }
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return await res.blob();
    },

    // Internal request helper — auto-attaches token and refreshes on 401.
    async _req(path, opts = {}) {
      await Auth.ensureToken();
      const init = {
        method: opts.method || 'GET',
        headers: {
          'Authorization': 'Bearer ' + State.accessToken,
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        },
        body: opts.body
      };
      const url = path.startsWith('http')
        ? path
        : 'https://www.googleapis.com/drive/v3' + path;
      let res = await fetch(url, init);
      if (res.status === 401) {
        // Token might have expired between calls
        await Auth.requestToken(false);
        init.headers.Authorization = 'Bearer ' + State.accessToken;
        res = await fetch(url, init);
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive API ${res.status}: ${text}`);
      }
      if (res.status === 204) return null;
      return await res.json();
    }
  };

  // ===================================================================
  // UI — rendering
  // ===================================================================
  const UI = {
    activeScreen: 'dashboard',

    switchScreen(screenName) {
      // dashboard, category, settings, login
      const screens = ['login', 'dashboard', 'category', 'settings'];
      screens.forEach(s => {
        const el = document.getElementById('screen-' + s);
        if (el) el.classList.toggle('is-active', s === screenName);
      });
      this.activeScreen = screenName;
      // Update bottom nav active state
      document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
        const target = btn.dataset.target;
        btn.classList.toggle('is-active',
          (target === 'dashboard' && (screenName === 'dashboard' || screenName === 'category')) ||
          (target === 'settings' && screenName === 'settings') ||
          (target === 'search' && screenName === 'dashboard' && State.dashboardSearch)
        );
      });
      // Scroll to top
      const active = document.getElementById('screen-' + screenName);
      if (active) {
        const c = active.querySelector('.content');
        if (c) c.scrollTop = 0;
      }
    },

    renderCategories() {
      const grid = document.getElementById('categories-grid');
      if (!grid) return;
      grid.innerHTML = '';
      State.categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'category-card';
        btn.style.setProperty('--card-tint', cat.color);
        btn.dataset.id = cat.id;
        btn.innerHTML = `
          <div class="category-card-icon" style="background:${cat.color}">${cat.icon}</div>
          <div>
            <div class="category-card-name">${escapeHtml(cat.name)}</div>
            <div class="category-card-count">${cat.count != null ? cat.count + (cat.count === 1 ? ' file' : ' files') : ''}</div>
          </div>
        `;
        btn.addEventListener('click', () => UI.openCategory(cat.id));
        grid.appendChild(btn);
      });
    },

    async openCategory(categoryId) {
      const cat = State.categories.find(c => c.id === categoryId);
      if (!cat) return;
      State.currentCategoryId = categoryId;
      State.currentFilter = { type: 'all', search: '' };

      // Update header
      document.getElementById('category-title').textContent = cat.name;
      const searchInput = document.getElementById('category-search');
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('#filter-chips .chip').forEach(c =>
        c.classList.toggle('is-active', c.dataset.filterType === 'all')
      );

      this.switchScreen('category');

      // Load — try cache first
      const cacheKey = 'docs_' + cat.folderId;
      const cached = Storage.getCache(cacheKey);
      if (cached) {
        State.documents[categoryId] = cached;
        this.renderDocuments();
      } else {
        this.renderDocuments(true); // skeleton
      }

      try {
        const files = await Drive.listFiles(cat.folderId);
        State.documents[categoryId] = files;
        Storage.setCache(cacheKey, files);
        // Update count on the category badge
        cat.count = files.length;
        Storage.set('categories', State.categories);
        this.renderDocuments();
      } catch (err) {
        console.error(err);
        Toast.show('Failed to load documents', 'error');
      }
    },

    renderDocuments(loading) {
      const list = document.getElementById('documents-list');
      const empty = document.getElementById('documents-empty');
      if (!list) return;
      const cat = State.categories.find(c => c.id === State.currentCategoryId);
      let files = State.documents[State.currentCategoryId] || [];

      if (loading && files.length === 0) {
        list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:14px;">Loading…</div>';
        empty.hidden = true;
        return;
      }

      // Apply filters
      const f = State.currentFilter;
      const search = (f.search || '').toLowerCase().trim();
      files = files.filter(file => {
        if (search && !file.name.toLowerCase().includes(search)) return false;
        if (f.type === 'pdf' && file.mimeType !== 'application/pdf') return false;
        if (f.type === 'image' && !file.mimeType.startsWith('image/')) return false;
        if (f.type === 'recent') {
          const age = Date.now() - new Date(file.modifiedTime).getTime();
          if (age > 30 * 24 * 60 * 60 * 1000) return false;
        }
        return true;
      });

      // Sort newest first
      files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

      if (files.length === 0) {
        list.innerHTML = '';
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      list.innerHTML = '';
      files.forEach(file => {
        const card = document.createElement('button');
        card.className = 'doc-card';
        card.dataset.id = file.id;

        const isImg = file.mimeType.startsWith('image/');
        const isPdf = file.mimeType === 'application/pdf';
        const tag = isPdf ? 'PDF' : (isImg ? 'IMG' : '');

        // Use thumbnailLink if present (Google sometimes returns one). Add
        // a size hint so it loads at the right resolution.
        const thumb = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, '=s220') : '';
        const thumbStyle = thumb ? `background-image:url('${thumb}')` : '';
        const placeholder = isPdf ? '📄' : (isImg ? '🖼️' : '📁');

        card.innerHTML = `
          <div class="doc-thumb" style="${thumbStyle}">
            ${thumb ? '' : `<span>${placeholder}</span>`}
            ${tag ? `<span class="doc-thumb-tag">${tag}</span>` : ''}
          </div>
          <div class="doc-info">
            <div class="doc-name">${escapeHtml(file.name)}</div>
            <div class="doc-meta">${formatDate(file.modifiedTime)} · ${formatSize(file.size)}</div>
          </div>
          <div class="doc-chevron">›</div>
        `;
        card.addEventListener('click', () => Modals.openViewer(file, cat));
        list.appendChild(card);
      });
    },

    renderSettingsCategories() {
      const wrap = document.getElementById('settings-categories');
      if (!wrap) return;
      wrap.innerHTML = '';
      State.categories.forEach(cat => {
        const row = document.createElement('div');
        row.className = 'cat-row';
        row.innerHTML = `
          <div class="cat-row-icon" style="background:${cat.color}">${cat.icon}</div>
          <div class="cat-row-name">${escapeHtml(cat.name)}</div>
          <div class="cat-row-actions">
            <button class="cat-mini-btn" data-action="rename" data-id="${cat.id}">Rename</button>
            <button class="cat-mini-btn danger" data-action="delete" data-id="${cat.id}">Delete</button>
          </div>
        `;
        row.querySelector('[data-action="rename"]').addEventListener('click', () => UI.openEditCategory(cat));
        row.querySelector('[data-action="delete"]').addEventListener('click', () => UI.confirmDeleteCategory(cat));
        wrap.appendChild(row);
      });
    },

    renderUserInfo() {
      const el = document.getElementById('settings-user-email');
      if (el && State.user) el.textContent = State.user.email || State.user.name || 'Connected';
    },

    // Run dashboard search across all categories
    runDashboardSearch(query) {
      State.dashboardSearch = (query || '').trim();
      const grid = document.getElementById('categories-grid');
      const results = document.getElementById('dashboard-search-results');
      const addBtn = document.getElementById('btn-add-category');

      if (!State.dashboardSearch) {
        grid.style.display = '';
        addBtn.style.display = '';
        results.hidden = true;
        return;
      }

      grid.style.display = 'none';
      addBtn.style.display = 'none';
      results.hidden = false;
      results.innerHTML = '';

      const q = State.dashboardSearch.toLowerCase();
      let any = false;

      State.categories.forEach(cat => {
        const files = State.documents[cat.id] || [];
        const matches = files.filter(f => f.name.toLowerCase().includes(q));
        if (matches.length === 0) return;
        any = true;

        const label = document.createElement('div');
        label.className = 'search-group-label';
        label.innerHTML = `<span style="color:${cat.color}">${cat.icon}</span> ${escapeHtml(cat.name)}`;
        results.appendChild(label);

        matches.forEach(file => {
          const card = document.createElement('button');
          card.className = 'doc-card';
          const tag = file.mimeType === 'application/pdf' ? 'PDF' : 'IMG';
          const thumb = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, '=s220') : '';
          card.innerHTML = `
            <div class="doc-thumb" style="${thumb ? `background-image:url('${thumb}')` : ''}">
              ${thumb ? '' : '<span>📄</span>'}
              <span class="doc-thumb-tag">${tag}</span>
            </div>
            <div class="doc-info">
              <div class="doc-name">${escapeHtml(file.name)}</div>
              <div class="doc-meta">${formatDate(file.modifiedTime)}</div>
            </div>
            <div class="doc-chevron">›</div>
          `;
          card.addEventListener('click', () => Modals.openViewer(file, cat));
          results.appendChild(card);
        });
      });

      if (!any) {
        results.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><h3>No matches</h3><p>Try a different search term.</p></div>`;
      }
    },

    // ----- Add / edit category sheet ----------------------------------
    _editingCategory: null,
    _selectedIcon: null,
    _selectedColor: null,

    openAddCategory() {
      this._editingCategory = null;
      this._selectedIcon = CONFIG.ICON_OPTIONS[0];
      this._selectedColor = CONFIG.COLOR_OPTIONS[0];
      document.getElementById('category-sheet-title').textContent = 'New Category';
      document.getElementById('category-name-input').value = '';
      this._renderIconPicker();
      this._renderColorPicker();
      Sheets.open('category-sheet');
      setTimeout(() => document.getElementById('category-name-input').focus(), 350);
    },

    openEditCategory(cat) {
      this._editingCategory = cat;
      this._selectedIcon = cat.icon;
      this._selectedColor = cat.color;
      document.getElementById('category-sheet-title').textContent = 'Edit Category';
      document.getElementById('category-name-input').value = cat.name;
      this._renderIconPicker();
      this._renderColorPicker();
      Sheets.open('category-sheet');
    },

    _renderIconPicker() {
      const w = document.getElementById('category-icon-picker');
      w.innerHTML = '';
      CONFIG.ICON_OPTIONS.forEach(icon => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-pick' + (icon === UI._selectedIcon ? ' is-selected' : '');
        b.textContent = icon;
        b.addEventListener('click', () => {
          UI._selectedIcon = icon;
          UI._renderIconPicker();
        });
        w.appendChild(b);
      });
    },

    _renderColorPicker() {
      const w = document.getElementById('category-color-picker');
      w.innerHTML = '';
      CONFIG.COLOR_OPTIONS.forEach(color => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color-pick' + (color === UI._selectedColor ? ' is-selected' : '');
        b.style.setProperty('--c', color);
        b.addEventListener('click', () => {
          UI._selectedColor = color;
          UI._renderColorPicker();
        });
        w.appendChild(b);
      });
    },

    async saveCategoryFromSheet() {
      const name = document.getElementById('category-name-input').value.trim();
      if (!name) { Toast.show('Please enter a name', 'error'); return; }
      const icon = this._selectedIcon;
      const color = this._selectedColor;
      Sheets.close('category-sheet');
      Loader.show(this._editingCategory ? 'Updating…' : 'Creating folder…');
      try {
        if (this._editingCategory) {
          await Drive.renameCategoryFolder(this._editingCategory.folderId, name, icon, color);
          this._editingCategory.name = name;
          this._editingCategory.icon = icon;
          this._editingCategory.color = color;
          Toast.show('Category updated', 'success');
        } else {
          const folder = await Drive.createCategoryFolder(name, icon, color);
          State.categories.push({
            id: folder.id, folderId: folder.id, name, icon, color, count: 0
          });
          Toast.show('Category created', 'success');
        }
        Storage.set('categories', State.categories);
        UI.renderCategories();
        UI.renderSettingsCategories();
      } catch (err) {
        console.error(err);
        Toast.show('Could not save category', 'error');
      } finally {
        Loader.hide();
      }
    },

    confirmDeleteCategory(cat) {
      if (!confirm(`Delete the "${cat.name}" category? Files inside will be moved to your Drive trash.`)) return;
      Loader.show('Deleting…');
      Drive.deleteCategoryFolder(cat.folderId).then(() => {
        State.categories = State.categories.filter(c => c.id !== cat.id);
        Storage.set('categories', State.categories);
        Storage.remove('docs_' + cat.folderId);
        UI.renderCategories();
        UI.renderSettingsCategories();
        Toast.show('Category deleted', 'success');
      }).catch(err => {
        console.error(err);
        Toast.show('Failed to delete', 'error');
      }).finally(() => Loader.hide());
    },

    // ----- Category action sheet (rename/delete from category page) ---
    openCategoryActions() {
      const cat = State.categories.find(c => c.id === State.currentCategoryId);
      if (!cat) return;
      Sheets.open('category-actions-sheet');
    }
  };

  // ===================================================================
  // MODALS — document viewer
  // ===================================================================
  const Modals = {
    currentFile: null,
    currentBlobUrl: null,

    async openViewer(file, category) {
      this.currentFile = file;
      const modal = document.getElementById('viewer-modal');
      const title = document.getElementById('viewer-title');
      const body = document.getElementById('viewer-body');
      title.textContent = file.name;
      body.innerHTML = `<div class="viewer-loading"><div class="loader-spinner" style="border-color:rgba(255,255,255,0.18);border-top-color:#fff"></div>Loading document…</div>`;
      modal.hidden = false;
      if (navigator.vibrate) navigator.vibrate(8);

      try {
        const blob = await Drive.downloadFileBlob(file.id);
        if (this.currentBlobUrl) URL.revokeObjectURL(this.currentBlobUrl);
        this.currentBlobUrl = URL.createObjectURL(blob);
        body.innerHTML = '';
        if (file.mimeType.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = this.currentBlobUrl;
          img.alt = file.name;
          body.appendChild(img);
        } else if (file.mimeType === 'application/pdf') {
          const iframe = document.createElement('iframe');
          iframe.src = this.currentBlobUrl + '#view=FitH';
          iframe.title = file.name;
          body.appendChild(iframe);
        } else {
          body.innerHTML = '<div class="viewer-loading">Preview not available for this file type.</div>';
        }
      } catch (err) {
        console.error(err);
        body.innerHTML = '<div class="viewer-loading">Could not load this file.</div>';
        Toast.show('Failed to load file', 'error');
      }
    },

    closeViewer() {
      const modal = document.getElementById('viewer-modal');
      modal.hidden = true;
      if (this.currentBlobUrl) {
        URL.revokeObjectURL(this.currentBlobUrl);
        this.currentBlobUrl = null;
      }
      this.currentFile = null;
    },

    async downloadCurrent() {
      if (!this.currentFile || !this.currentBlobUrl) return;
      const a = document.createElement('a');
      a.href = this.currentBlobUrl;
      a.download = this.currentFile.name;
      a.click();
      Toast.show('Saving…', 'success');
    },

    async deleteCurrent() {
      if (!this.currentFile) return;
      if (!confirm(`Delete "${this.currentFile.name}"? It will be moved to your Drive trash.`)) return;
      Loader.show('Deleting…');
      try {
        await Drive.deleteFile(this.currentFile.id);
        // Remove from state
        const catId = State.currentCategoryId;
        if (State.documents[catId]) {
          State.documents[catId] = State.documents[catId].filter(f => f.id !== this.currentFile.id);
          const cat = State.categories.find(c => c.id === catId);
          if (cat) cat.count = State.documents[catId].length;
          Storage.setCache('docs_' + cat.folderId, State.documents[catId]);
          Storage.set('categories', State.categories);
        }
        UI.renderDocuments();
        UI.renderCategories();
        this.closeViewer();
        Toast.show('Deleted', 'success');
      } catch (err) {
        console.error(err);
        Toast.show('Failed to delete', 'error');
      } finally {
        Loader.hide();
      }
    }
  };

  // ===================================================================
  // PULL-TO-REFRESH
  // ===================================================================
  const PullToRefresh = {
    container: null,
    indicator: null,
    startY: 0,
    pulling: false,
    distance: 0,
    threshold: 65,

    bind(containerEl) {
      this.container = containerEl;
      this.indicator = document.getElementById('ptr');
      containerEl.addEventListener('touchstart', this._onStart.bind(this), { passive: true });
      containerEl.addEventListener('touchmove', this._onMove.bind(this), { passive: false });
      containerEl.addEventListener('touchend', this._onEnd.bind(this), { passive: true });
    },

    _onStart(e) {
      if (this.container.scrollTop > 0) return;
      this.startY = e.touches[0].clientY;
      this.pulling = true;
      this.distance = 0;
    },

    _onMove(e) {
      if (!this.pulling) return;
      const y = e.touches[0].clientY;
      const dy = y - this.startY;
      if (dy <= 0) { this.pulling = false; return; }
      if (this.container.scrollTop > 0) { this.pulling = false; return; }
      e.preventDefault();
      this.distance = Math.min(dy * 0.5, 100);
      if (this.indicator) {
        this.indicator.classList.add('is-pulling');
        this.indicator.style.transform = `translateY(${this.distance - 60}px)`;
        const spinner = this.indicator.querySelector('.ptr-spinner');
        if (spinner) spinner.style.transform = `rotate(${this.distance * 3.6}deg)`;
      }
    },

    _onEnd() {
      if (!this.pulling) return;
      this.pulling = false;
      if (this.distance >= this.threshold) {
        this._refresh();
      } else {
        this.indicator.classList.remove('is-pulling');
        this.indicator.style.transform = '';
      }
      this.distance = 0;
    },

    async _refresh() {
      this.indicator.classList.remove('is-pulling');
      this.indicator.classList.add('is-refreshing');
      this.indicator.style.transform = 'translateY(0)';
      if (navigator.vibrate) navigator.vibrate(10);
      try {
        if (UI.activeScreen === 'dashboard') {
          await App.loadCategories(true);
        } else if (UI.activeScreen === 'category' && State.currentCategoryId) {
          const cat = State.categories.find(c => c.id === State.currentCategoryId);
          if (cat) {
            const files = await Drive.listFiles(cat.folderId);
            State.documents[cat.id] = files;
            cat.count = files.length;
            Storage.setCache('docs_' + cat.folderId, files);
            Storage.set('categories', State.categories);
            UI.renderDocuments();
          }
        }
        Toast.show('Updated', 'success', 1200);
      } catch (err) {
        console.error(err);
        Toast.show('Refresh failed', 'error');
      } finally {
        this.indicator.classList.remove('is-refreshing');
        this.indicator.style.transform = '';
      }
    }
  };

  // ===================================================================
  // THEME
  // ===================================================================
  const Theme = {
    apply(mode) {
      document.body.classList.remove('theme-light', 'theme-dark', 'theme-system');
      document.body.classList.add('theme-' + mode);
      Storage.set('theme', mode);
      // Update theme-color meta dynamically
      const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const meta = document.querySelector('meta[name="theme-color"]:not([media])') ||
                   document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', isDark ? '#000000' : '#f2f2f7');
    },
    init() {
      const saved = Storage.get('theme') || 'system';
      this.apply(saved);
      const sel = document.getElementById('theme-select');
      if (sel) {
        sel.value = saved;
        sel.addEventListener('change', () => this.apply(sel.value));
      }
    }
  };

  // ===================================================================
  // PWA — service worker registration
  // ===================================================================
  const PWA = {
    register() {
      if (!('serviceWorker' in navigator)) return;
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
          .then(reg => console.log('[PWA] Service worker registered', reg.scope))
          .catch(err => console.warn('[PWA] SW registration failed', err));
      });
    }
  };

  // ===================================================================
  // GOOGLE PICKER (lazy-loaded)
  // ===================================================================
  const Picker = {
    async load() {
      if (State.pickerLoaded) return;
      await new Promise((resolve, reject) => {
        gapi.load('picker', { callback: resolve, onerror: reject });
      });
      State.pickerLoaded = true;
    },
    async open(onPick) {
      try {
        await this.load();
        await Auth.ensureToken();
        const view = new google.picker.DocsView()
          .setIncludeFolders(false)
          .setMimeTypes('application/pdf,image/jpeg,image/png');
        const picker = new google.picker.PickerBuilder()
          .enableFeature(google.picker.Feature.NAV_HIDDEN)
          .setOAuthToken(State.accessToken)
          .setDeveloperKey(CONFIG.GOOGLE_API_KEY)
          .setAppId(CONFIG.GOOGLE_APP_ID)
          .addView(view)
          .setCallback((data) => {
            if (data.action === google.picker.Action.PICKED) {
              onPick(data.docs);
            }
          })
          .build();
        picker.setVisible(true);
      } catch (err) {
        console.error(err);
        Toast.show('Picker unavailable — using device upload instead', 'error');
        document.getElementById('file-input').click();
      }
    }
  };

  // ===================================================================
  // APP — bootstrap & event wiring
  // ===================================================================
  const App = {
    async init() {
      // UI subsystems
      Toast.init();
      Loader.init();
      Sheets.init();
      Theme.init();
      PWA.register();

      // Wire up static event handlers
      this._bindEvents();

      // Try to silently restore session if user previously signed in
      const savedUser = Storage.get('user');
      const savedRoot = Storage.get('rootFolderId');
      if (savedUser) State.user = savedUser;
      if (savedRoot) State.rootFolderId = savedRoot;

      // Wait for Google libs to be ready, then attempt silent sign-in
      try {
        await Auth.waitForLibs();
        if (savedUser) {
          // Try silent token grab. If it fails, show login.
          try {
            await Auth.requestToken(false);
            await this._postSignIn();
            return;
          } catch (e) {
            console.log('Silent sign-in failed', e);
          }
        }
      } catch (err) {
        console.error('Lib init error', err);
      }
      // Fallback: show login screen (already active)
    },

    _bindEvents() {
      // Sign in
      document.getElementById('btn-google-signin').addEventListener('click', async () => {
        Loader.show('Signing in…');
        try {
          await Auth.waitForLibs();
          await Auth.requestToken(true);
          await this._postSignIn();
        } catch (err) {
          console.error(err);
          Toast.show('Sign-in failed', 'error');
        } finally {
          Loader.hide();
        }
      });

      // Sign out
      document.getElementById('row-signout').addEventListener('click', () => {
        if (confirm('Sign out from Google Drive?')) Auth.signOut();
      });

      // Bottom nav
      document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.target;
          if (target === 'dashboard') UI.switchScreen('dashboard');
          else if (target === 'settings') {
            UI.renderSettingsCategories();
            UI.renderUserInfo();
            UI.switchScreen('settings');
          } else if (target === 'search') {
            UI.switchScreen('dashboard');
            const search = document.getElementById('dashboard-search');
            if (search) { search.focus(); search.scrollIntoView({ behavior: 'smooth' }); }
          }
          if (navigator.vibrate) navigator.vibrate(5);
        });
      });

      // Open settings from header
      document.getElementById('btn-open-settings').addEventListener('click', () => {
        UI.renderSettingsCategories();
        UI.renderUserInfo();
        UI.switchScreen('settings');
      });

      // Back buttons
      document.getElementById('btn-back-from-category').addEventListener('click', () =>
        UI.switchScreen('dashboard'));
      document.getElementById('btn-back-from-settings').addEventListener('click', () =>
        UI.switchScreen('dashboard'));

      // Category page header menu
      document.getElementById('btn-category-menu').addEventListener('click', () =>
        UI.openCategoryActions());

      // Add category buttons
      document.getElementById('btn-add-category').addEventListener('click', () => UI.openAddCategory());
      document.getElementById('btn-add-category-settings').addEventListener('click', () => UI.openAddCategory());

      // Save category
      document.getElementById('btn-save-category').addEventListener('click', () =>
        UI.saveCategoryFromSheet());

      // Category actions sheet
      document.getElementById('btn-rename-category').addEventListener('click', () => {
        Sheets.close('category-actions-sheet');
        const cat = State.categories.find(c => c.id === State.currentCategoryId);
        if (cat) UI.openEditCategory(cat);
      });
      document.getElementById('btn-delete-category').addEventListener('click', () => {
        Sheets.close('category-actions-sheet');
        const cat = State.categories.find(c => c.id === State.currentCategoryId);
        if (cat) {
          UI.confirmDeleteCategory(cat);
          UI.switchScreen('dashboard');
        }
      });

      // Filter chips
      document.querySelectorAll('#filter-chips .chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#filter-chips .chip').forEach(c => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          State.currentFilter.type = chip.dataset.filterType;
          UI.renderDocuments();
        });
      });

      // Category page search
      document.getElementById('category-search').addEventListener('input', (e) => {
        State.currentFilter.search = e.target.value;
        UI.renderDocuments();
      });

      // Dashboard search
      document.getElementById('dashboard-search').addEventListener('input', (e) => {
        UI.runDashboardSearch(e.target.value);
      });

      // FAB → open upload sheet
      document.getElementById('btn-fab-upload').addEventListener('click', () => {
        const cat = State.categories.find(c => c.id === State.currentCategoryId);
        if (cat) {
          document.getElementById('upload-sheet-sub').textContent =
            `Upload a PDF or photo to ${cat.name}.`;
        }
        Sheets.open('upload-sheet');
      });

      // Upload sheet actions
      document.getElementById('btn-upload-file').addEventListener('click', () => {
        Sheets.close('upload-sheet');
        document.getElementById('file-input').click();
      });
      document.getElementById('btn-take-photo').addEventListener('click', () => {
        Sheets.close('upload-sheet');
        document.getElementById('camera-input').click();
      });
      document.getElementById('btn-pick-from-drive').addEventListener('click', async () => {
        Sheets.close('upload-sheet');
        Picker.open(async (docs) => {
          // Picker returns existing files — copy them into our category folder.
          const cat = State.categories.find(c => c.id === State.currentCategoryId);
          if (!cat) return;
          for (const doc of docs) {
            try {
              Loader.show('Adding from Drive…');
              await Drive._req(`/files/${doc.id}/copy?fields=id`, {
                method: 'POST',
                body: JSON.stringify({ parents: [cat.folderId] })
              });
            } catch (err) {
              console.error(err);
              Toast.show('Could not add ' + doc.name, 'error');
            } finally {
              Loader.hide();
            }
          }
          // Reload list
          const files = await Drive.listFiles(cat.folderId);
          State.documents[cat.id] = files;
          cat.count = files.length;
          Storage.setCache('docs_' + cat.folderId, files);
          UI.renderDocuments();
          Toast.show('Files added', 'success');
        });
      });

      // File-input handler (covers both upload-from-device and camera)
      ['file-input', 'camera-input'].forEach(id => {
        document.getElementById(id).addEventListener('change', async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = ''; // reset so same file can be chosen again
          if (files.length === 0) return;
          await this._uploadFiles(files);
        });
      });

      // Viewer
      document.getElementById('btn-close-viewer').addEventListener('click', () => Modals.closeViewer());
      document.getElementById('btn-download').addEventListener('click', () => Modals.downloadCurrent());
      document.getElementById('btn-delete-doc').addEventListener('click', () => Modals.deleteCurrent());

      // Storage info → open Drive folder in new tab
      document.getElementById('row-storage-info').addEventListener('click', () => {
        if (State.rootFolderId) {
          window.open('https://drive.google.com/drive/folders/' + State.rootFolderId, '_blank');
        }
      });

      // Bind PTR to dashboard & category content
      const dashContent = document.querySelector('#screen-dashboard .content');
      const catContent  = document.querySelector('#screen-category .content');
      if (dashContent) PullToRefresh.bind(dashContent);
      if (catContent)  PullToRefresh.bind(catContent);

      // Close viewer on swipe down
      let viewerTouchStart = 0;
      const viewerEl = document.getElementById('viewer-modal');
      viewerEl.addEventListener('touchstart', (e) => { viewerTouchStart = e.touches[0].clientY; });
      viewerEl.addEventListener('touchend', (e) => {
        const dy = (e.changedTouches[0].clientY - viewerTouchStart);
        if (dy > 90 && viewerEl.querySelector('.viewer-body').scrollTop === 0) {
          Modals.closeViewer();
        }
      });

      // ESC closes modals/sheets
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (!viewerEl.hidden) Modals.closeViewer();
          ['upload-sheet','category-sheet','category-actions-sheet'].forEach(id => {
            const s = document.getElementById(id);
            if (s && s.dataset.open === 'true') Sheets.close(id);
          });
        }
      });

      // Watch system theme changes for the "system" mode
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const mode = Storage.get('theme') || 'system';
        if (mode === 'system') Theme.apply('system');
      });
    },

    // -----------------------------------------------------------------
    // After successful sign-in: fetch user, ensure root folder, load
    // categories, and switch to dashboard.
    // -----------------------------------------------------------------
    async _postSignIn() {
      Loader.show('Connecting to Drive…');
      try {
        const profile = await Auth.fetchUserInfo();
        if (profile) {
          State.user = { email: profile.email, name: profile.name, picture: profile.picture };
          Storage.set('user', State.user);
          UI.renderUserInfo();
        }
        await Drive.ensureRootFolder();
        await this.loadCategories(false);

        // Reveal app
        document.getElementById('screen-login').classList.remove('is-active');
        document.getElementById('app-shell').hidden = false;
        UI.switchScreen('dashboard');
        State.isInitialized = true;
      } catch (err) {
        console.error(err);
        Toast.show('Could not connect to Drive', 'error');
      } finally {
        Loader.hide();
      }
    },

    // Load category folders from Drive. If empty (first-time user), seed
    // with the default categories from CONFIG.
    async loadCategories(forceReload) {
      if (!forceReload) {
        const cached = Storage.getCache('categories', CONFIG.CACHE_TTL);
        if (cached && cached.length) {
          State.categories = cached;
          UI.renderCategories();
        }
      }
      try {
        let folders = await Drive.listCategoryFolders();

        // First-time user → seed defaults
        if (folders.length === 0) {
          Loader.show('Setting up categories…');
          for (const def of CONFIG.DEFAULT_CATEGORIES) {
            const f = await Drive.createCategoryFolder(def.name, def.icon, def.color);
            folders.push({ ...f, description: JSON.stringify({ icon: def.icon, color: def.color }) });
          }
          Loader.hide();
        }

        State.categories = folders.map(f => {
          let meta = {};
          try { meta = JSON.parse(f.description || '{}'); } catch {}
          // Match against defaults by name for icon/color fallback
          const def = CONFIG.DEFAULT_CATEGORIES.find(d => d.name === f.name) || {};
          return {
            id: f.id,
            folderId: f.id,
            name: f.name,
            icon: meta.icon || def.icon || '📁',
            color: meta.color || def.color || '#8E8E93',
            count: null
          };
        });

        // Stable order: defaults first (in their natural order), then custom by name
        const defaultOrder = CONFIG.DEFAULT_CATEGORIES.map(d => d.name);
        State.categories.sort((a, b) => {
          const ia = defaultOrder.indexOf(a.name);
          const ib = defaultOrder.indexOf(b.name);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a.name.localeCompare(b.name);
        });

        Storage.set('categories', State.categories);
        Storage.setCache('categories', State.categories);
        UI.renderCategories();

        // Optionally fetch counts in background (cached if we have them)
        State.categories.forEach(async (cat) => {
          const cached = Storage.getCache('docs_' + cat.folderId);
          if (cached) {
            cat.count = cached.length;
            UI.renderCategories();
          }
        });
      } catch (err) {
        console.error(err);
        Toast.show('Could not load categories', 'error');
      }
    },

    // -----------------------------------------------------------------
    // Upload selected files to current category
    // -----------------------------------------------------------------
    async _uploadFiles(files) {
      const cat = State.categories.find(c => c.id === State.currentCategoryId);
      if (!cat) { Toast.show('Choose a category first', 'error'); return; }
      const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
      const VALID = ['application/pdf', 'image/jpeg', 'image/png'];

      for (const file of files) {
        if (file.size > MAX_SIZE) {
          Toast.show(`${file.name} is too large (max 25 MB)`, 'error');
          continue;
        }
        if (!VALID.includes(file.type) && !file.name.match(/\.(pdf|jpe?g|png)$/i)) {
          Toast.show(`${file.name} is an unsupported file type`, 'error');
          continue;
        }
        Loader.show(`Uploading ${file.name}…`);
        try {
          const meta = await Drive.uploadFile(file, cat.folderId, (p) => {
            const t = document.getElementById('loader-text');
            if (t) t.textContent = `Uploading ${file.name} · ${Math.round(p * 100)}%`;
          });
          // Add to local state
          const filesArr = State.documents[cat.id] || [];
          filesArr.unshift({
            id: meta.id,
            name: meta.name || file.name,
            mimeType: meta.mimeType || file.type,
            size: meta.size || file.size,
            modifiedTime: meta.modifiedTime || new Date().toISOString(),
            thumbnailLink: meta.thumbnailLink || null
          });
          State.documents[cat.id] = filesArr;
          cat.count = filesArr.length;
          Storage.setCache('docs_' + cat.folderId, filesArr);
          Storage.set('categories', State.categories);
          UI.renderDocuments();
          UI.renderCategories();
          Toast.show(`${file.name} added`, 'success');
        } catch (err) {
          console.error(err);
          Toast.show(`Failed to upload ${file.name}`, 'error');
        } finally {
          Loader.hide();
        }
      }
    }
  };

  // ===================================================================
  // UTILITIES
  // ===================================================================
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (sameDay) return 'Today, ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isYesterday) return 'Yesterday';
    if (now.getFullYear() === d.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatSize(bytes) {
    if (bytes == null) return '';
    bytes = Number(bytes);
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ===================================================================
  // BOOT
  // ===================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }
})();
