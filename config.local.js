// =============================================================
// CONFIG OVERRIDE — example
// =============================================================
// Copy this file to `config.local.js` (alongside index.html and
// app.js) and fill in your real Google Cloud credentials.
//
// `config.local.js` is loaded BEFORE app.js by index.html. The
// values below override the placeholders in app.js's CONFIG block,
// so the placeholders can stay in source control while your real
// keys live only on your machine + deploy target.
//
// Add this single line to .gitignore:
//   config.local.js
//
// Make sure your API key is *restricted* in Google Cloud Console:
//   - Application restrictions → HTTP referrers, list your origins
//   - API restrictions → restrict to "Google Picker API" and
//     "Google Drive API" only.
// A restricted API key is safe to deploy to a public site (and
// has to be — there's no way to hide it from a browser).
// =============================================================

window.FDM_CONFIG = {
  GOOGLE_CLIENT_ID: '351448430343-515k9hq0lvfqd34j1472m5d83nl6bkj8.apps.googleusercontent.com',
  GOOGLE_API_KEY:   'AIzaSyDqdlaquRDu8HRqXmD59ZSdX6V6Jp2Ls90',
  GOOGLE_APP_ID:    '351448430343'
};
