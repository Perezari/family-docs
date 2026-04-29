# Family Documents Manager

A production-grade **Document Management Progressive Web App** with an iOS 17 native look. All your family's important paperwork — car registrations, municipal tax bills, insurance policies, kids' documents, medical records — organised into categories and stored exclusively in **your own Google Drive**.

No backend. No database. No tracking. Just clean vanilla JavaScript talking directly to Google Drive on your behalf.

## Features

- 📂 **Category-based organisation** with 9 sensible defaults plus custom categories you can add or rename.
- ☁️ **Google Drive as your storage** — files live in a single folder named *Family Documents Manager* in your Drive.
- 📤 **Upload from device, take photo, or pick from Drive** (Google Picker).
- 🔍 **Real-time search** across all categories plus per-category filtering by file type or recency.
- 👀 **In-app PDF & image viewer** with full-screen iOS-style modal.
- 🌗 **Light & Dark mode** with full system theme support.
- 📱 **PWA installable** — adds to iOS home screen with native splash & icon, works offline (shell), pull-to-refresh, haptic-style micro-interactions.
- 🔒 **Scoped access** — uses the `drive.file` OAuth scope, so the app can only see files it created or that you explicitly opened with it. The rest of your Drive remains invisible.

## Project structure

```
family-docs/
├── index.html              ← UI shell, all screens, modals
├── app.css                 ← iOS 17 design system (light/dark)
├── app.js                  ← Auth + Drive + UI + PWA logic
├── manifest.json           ← PWA manifest
├── service-worker.js       ← Offline shell caching
├── generate_icons.py       ← Regenerate icons (Python + Pillow)
├── icons/
│   ├── icon-180.png        ← iOS apple-touch-icon
│   ├── icon-192.png        ← Standard PWA icon
│   ├── icon-512.png        ← Standard PWA icon
│   ├── icon-maskable-512.png
│   └── splash.png          ← iOS startup image
└── README.md
```

---

## 1 · Configure Google OAuth + Drive API

Before the app can sign you in, you need three Google credentials. The whole process is free and takes about 5 minutes.

### Step 1 — Create a Google Cloud project

1. Go to <https://console.cloud.google.com/projectcreate>
2. Name it *Family Documents* (or anything you like). Click **Create**.
3. Once it's ready, make sure the new project is selected in the top bar.
4. **Note your Project Number** — you'll find it on the project's *Welcome / Dashboard* page. This is your `GOOGLE_APP_ID` (used by the Drive Picker).

### Step 2 — Enable the APIs

Open each of these URLs (with your project selected) and click **Enable**:

- Google Drive API → <https://console.cloud.google.com/apis/library/drive.googleapis.com>
- Google Picker API → <https://console.cloud.google.com/apis/library/picker.googleapis.com>

### Step 3 — Configure the OAuth consent screen

1. Open <https://console.cloud.google.com/apis/credentials/consent>
2. Choose **External** and click *Create*.
3. Fill in:
   - **App name**: Family Documents
   - **User support email**: your email
   - **Developer contact email**: your email
4. **Scopes** — click *Add or Remove Scopes*, then check:
   - `.../auth/drive.file` (See, edit, create, and delete only the specific Google Drive files you use with this app)
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
5. **Test users** — add your own Google email so you can sign in while the app is in *Testing* mode. (You don't need to publish it.)

### Step 4 — Create the OAuth 2.0 Client ID

1. Open <https://console.cloud.google.com/apis/credentials>
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. **Authorized JavaScript origins** — add every URL you'll serve the app from. For example:
   - `http://localhost:8080` — for local development
   - `https://yourname.github.io` — if you deploy to GitHub Pages
5. **Authorized redirect URIs** — leave empty (we don't use redirect-based auth).
6. Click *Create* and copy the **Client ID**.

### Step 5 — Create an API Key

1. Same Credentials page → **Create Credentials → API key**.
2. Click *Restrict key* once created:
   - **Application restrictions** → *HTTP referrers*. Add the same origins as above (e.g. `http://localhost:8080/*`, `https://yourname.github.io/*`).
   - **API restrictions** → *Restrict key* → check **Google Drive API** and **Google Picker API**.
3. Save. Copy the **API key** value.

### Step 6 — Paste the values into `app.js`

Open `app.js` and edit the `CONFIG` block at the top:

```js
const CONFIG = {
  GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  GOOGLE_API_KEY:   'YOUR_API_KEY',
  GOOGLE_APP_ID:    'YOUR_PROJECT_NUMBER',   // Cloud project number
  ...
};
```

That's all — the app pulls everything else from these.

---

## 2 · Run it locally

The app is fully static, but Google's OAuth requires a real `http://` or `https://` origin (not `file://`). Use any static server.

### Option A — Python (built-in)

```bash
cd family-docs
python3 -m http.server 8080
```

Then open <http://localhost:8080> in Safari (iPhone) or Chrome.

### Option B — Node

```bash
npx serve -p 8080
```

> **Important:** the port number must match an *Authorized JavaScript origin* you registered in Step 4 above.

---

## 3 · Deploy

This is just three files plus a folder of icons — drop it on any static host.

### GitHub Pages

1. Push the `family-docs/` folder to a repo (e.g. `family-docs`).
2. Repo → Settings → Pages → set Source to `main` branch / root.
3. Add `https://<you>.github.io` (and the full path if needed) to your Authorized JavaScript origins in Google Cloud.
4. Visit the URL on your iPhone, tap **Share → Add to Home Screen**, and you'll get a real iOS-style app icon.

### Netlify / Vercel / Cloudflare Pages

Drag-and-drop or `git push`. Add the resulting URL to your Authorized origins.

---

## 4 · Adding to iOS Home Screen

1. Open the deployed URL in **Safari** on iPhone.
2. Tap the Share icon → **Add to Home Screen**.
3. Launch from home screen — it opens in standalone mode with the iOS status bar style and no Safari chrome.

The included `apple-touch-icon` and `apple-touch-startup-image` ensure the icon and splash screen look native.

---

## 5 · Customising

- **Default categories** — edit `CONFIG.DEFAULT_CATEGORIES` in `app.js`.
- **Available icons / colors when adding custom categories** — edit `CONFIG.ICON_OPTIONS` and `CONFIG.COLOR_OPTIONS`.
- **App name** — change in `manifest.json`, `index.html`'s `<title>`, and the login screen header.
- **Icons** — re-run `python3 generate_icons.py` after editing the script (Pillow required: `pip install Pillow`).
- **Theme colors** — all design tokens live in `:root`, `body.theme-light` and `body.theme-dark` at the top of `app.css`. Override variables to retheme.

---

## 6 · How your data is handled

- **No third party** — there is no backend server. The browser talks directly to Google.
- **No analytics, no tracking, no telemetry.**
- **Scope** — `drive.file` only. The app cannot list any file in your Drive that wasn't created (or copied) into the *Family Documents Manager* folder by this app.
- **Sign-out** revokes the current access token and clears local cache. Files in Drive are unaffected.
- **Deleting** a category or document moves it to your Drive trash — Google holds it for 30 days; you can restore from <https://drive.google.com/drive/trash> within that window.

---

## 7 · Troubleshooting

- **"Sign-in failed" / popup blocked** — Browsers block OAuth popups when triggered without a user click. Always start the flow from the *Sign in with Google* button.
- **`idpiframe_initialization_failed`** — Your origin isn't in the *Authorized JavaScript origins* list, or the Drive API isn't enabled.
- **`403 access_denied`** — While the OAuth consent screen is in *Testing*, only addresses listed under *Test users* can sign in.
- **Picker shows blank** — `GOOGLE_APP_ID` must be your *project number* (a long integer), not the Client ID. Find it under *IAM & Admin → Settings* in Cloud Console.
- **Files don't show after upload** — Pull to refresh. The Drive thumbnail can take a few seconds to generate; the file is already there.
- **Service worker stuck on old version** — Open DevTools → Application → Service Workers → Unregister, then reload.

---

## 8 · License

MIT — do whatever you want with it. No warranty.
