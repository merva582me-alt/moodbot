# MoodBot Distribution & Auth Readiness Audit Plan

## Top-Level Overview

This plan documents all issues found in the MoodBot Electron app that must be resolved before it can be distributed, sold, or have a payment/license system added. It is broken into three tiers:

- **Tier 1 — Blockers:** Must be fixed before any public release
- **Tier 2 — Should Fix:** Strongly recommended before selling
- **Tier 3 — Nice to Have:** Post-launch improvements

The app is a working Electron + React + Vite desktop app targeting Windows (primary), macOS, and Linux. It automates MeetMe livestreams. A Windows installer has already been built (`release/MoodBot Installer.exe`). The core Electron security model is partially correct (nodeIntegration off, contextIsolation on) but has critical regressions.

---

## Tier 1 — Blockers (Must Fix Before Release)

---

### Sub-Task 1.1 — Disable Sandbox is a Critical Security Regression

**Status:** [ ] pending

**Intent:** The Electron sandbox is explicitly disabled for both the main window and all WebContentsView instances. This removes Electron's primary browser-process isolation mechanism. Before distributing or adding auth, this must be addressed.

**Expected Outcomes:**
- `sandbox: true` (or the option removed, since `true` is the Electron default) in all BrowserWindow and WebContentsView `webPreferences`
- App still loads and functions correctly after the change
- If there is a technical reason sandbox cannot be enabled (e.g., a native module that requires it off), that reason is documented in code comments

**Todo List:**
1. Change `sandbox: false` → `sandbox: true` at `main.js:149` (main BrowserWindow)
2. Change `sandbox: false` → `sandbox: true` at `main.js:783` (WebContentsView)
3. Test that the app still loads, MeetMe chat still scrapes, and TTS still works
4. If the app crashes with sandbox enabled, investigate which IPC handler or native call requires sandbox off, and document why in a comment

**Relevant Context:**
- `main.js:147-149` — main window webPreferences
- `main.js:781-783` — WebContentsView webPreferences
- Electron docs: sandbox must be explicitly disabled only when a preload needs direct Node access that contextBridge cannot handle

---

### Sub-Task 1.2 — Disable DevTools in Packaged Builds

**Status:** [ ] pending

**Intent:** DevTools is never explicitly disabled. Any end-user can open DevTools (F12 or right-click > Inspect), read the full localStorage (which contains plaintext MeetMe credentials), and inspect all IPC traffic. This must be locked down in production.

**Expected Outcomes:**
- DevTools is only accessible when `!app.isPackaged` (i.e., in local development)
- In a packaged build, opening DevTools via keyboard shortcut or menu is not possible

**Todo List:**
1. In `main.js`, find where `mainWindow` is created (around line 145)
2. Add `devTools: !app.isPackaged` to its `webPreferences` block
3. Verify in a dev run that DevTools still opens with F12
4. Rebuild and verify in packaged app that DevTools is blocked

**Relevant Context:**
- `main.js:145-162` — BrowserWindow creation and webPreferences

---

### Sub-Task 1.3 — Move MeetMe Credentials Out of Plaintext localStorage

**Status:** [ ] pending

**Intent:** `src/App.tsx` persists the user's MeetMe email and password as plaintext JSON in `localStorage` under the key `meetme_auth`. Any attacker or malicious extension with access to the Electron userData directory can read these credentials. Electron provides `safeStorage` (OS-level encryption) for exactly this use case.

**Expected Outcomes:**
- User credentials (email, password, streamUrl) are encrypted at rest using `electron.safeStorage`
- The renderer never handles raw credentials in localStorage; it passes them to the main process via IPC which stores/retrieves them using `safeStorage`
- On first run after migration, old plaintext localStorage key is cleared

**Todo List:**
1. In `main.js`, add two new `ipcMain.handle` handlers:
   - `auth:store` — accepts `{ email, password, streamUrl }`, encrypts each field with `safeStorage.encryptString()`, stores to a file in `app.getPath('userData')`
   - `auth:retrieve` — reads encrypted file, decrypts with `safeStorage.decryptString()`, returns the object
2. In `preload.cjs`, expose `storeAuth` and `retrieveAuth` via `contextBridge`
3. In `src/App.tsx`, replace all `localStorage.setItem('meetme_auth', ...)` and `localStorage.getItem('meetme_auth')` calls with calls to the new IPC bridge
4. On app startup, check if old `meetme_auth` localStorage key exists and migrate it to safeStorage, then delete the old key

**Relevant Context:**
- `src/App.tsx:114` and `src/App.tsx:140` — current localStorage reads
- `preload.cjs` — existing contextBridge setup to extend
- `main.js` — location to add new ipcMain handlers

---

### Sub-Task 1.4 — Verify and Document Hardcoded Base64 Authorization Header

**Status:** [ ] pending

**Intent:** `main.js:1568` contains `'Authorization': 'Basic bWVldG1lOnNlY3JldA=='` which base64-decodes to `meetme:secret`. This is sent to the MeetMe OAuth token endpoint. Before distributing, this must be classified: is it a public client ID/secret (safe to ship) or a private credential (must be protected)?

**Expected Outcomes:**
- Determination is documented in a code comment at `main.js:1568`
- If it is a private credential, it is moved to `safeStorage` or environment-level config and NOT shipped in plaintext source

**Todo List:**
1. Inspect the endpoint at `main.js:1568` — identify what OAuth flow is being used (client_credentials? implicit?)
2. Check MeetMe's developer documentation to confirm if `meetme:secret` is a known public client credential
3. Add a code comment: `// MeetMe public OAuth client_id:client_secret — confirmed public in MeetMe docs`
4. If it is NOT public, encrypt it or move it to a config that is not in the distributed source

**Relevant Context:**
- `main.js:1568` — the hardcoded Authorization header

---

### Sub-Task 1.5 — Disable Sourcemaps in Production Build

**Status:** [ ] pending

**Intent:** `vite.config.ts` has no `build.sourcemap: false` setting. By Vite's default, sourcemaps may be included or referenced in the built output. If `.map` files are bundled into the distributed app, an attacker can reconstruct the full TypeScript source code from the packaged binary.

**Expected Outcomes:**
- `vite.config.ts` explicitly sets `build: { sourcemap: false }`
- After `vite build`, the `dist/assets/` directory contains no `.map` files

**Todo List:**
1. Open `vite.config.ts`
2. Add `build: { sourcemap: false }` to the returned config object
3. Run `npm run build` and confirm no `.map` files exist in `dist/assets/`

**Relevant Context:**
- `vite.config.ts:1-23` — entire config file

---

### Sub-Task 1.6 — Remove Unused Production Dependencies

**Status:** [ ] pending

**Intent:** `package.json` lists `express` and `dotenv` as production `dependencies`, but neither is used in the codebase. These add unnecessary attack surface to the packaged binary and inflate the installer size.

**Expected Outcomes:**
- `express` and `dotenv` removed from `dependencies`
- `@types/express` removed from `devDependencies`
- App still builds and runs correctly

**Todo List:**
1. Confirm `express` is not imported anywhere: `grep -r "require('express')\|from 'express'" src/ main.js`
2. Confirm `dotenv` is not imported anywhere: `grep -r "require('dotenv')\|from 'dotenv'" src/ main.js`
3. Remove both from `package.json` dependencies
4. Remove `@types/express` from devDependencies
5. Run `npm install` to update lockfile
6. Run `npm run build` to confirm no breakage

**Relevant Context:**
- `package.json:89-90` — the two unused dependencies

---

## Tier 2 — Should Fix Before Selling

---

### Sub-Task 2.1 — Add Code Signing

**Status:** [ ] pending

**Intent:** The distributed Windows installer is unsigned. Windows SmartScreen will display a "Windows protected your PC" warning to every user who installs it. macOS will refuse to open an unsigned app entirely without manual override (`xattr -rd com.apple.quarantine`). Code signing is essential before charging money for the app.

**Expected Outcomes:**
- Windows build signed with a valid EV or OV code signing certificate (from DigiCert, Sectigo, etc.)
- macOS build notarized with Apple Developer ID
- Users can install and run the app without security warnings

**Todo List:**
1. Purchase a Windows code signing certificate (EV recommended for immediate SmartScreen trust, ~$300/yr; OV also works but takes time to build reputation)
2. Add signing config to `package.json` `build.win` block: `"certificateFile"`, `"certificatePassword"` (loaded from env, not hardcoded)
3. For macOS: enroll in Apple Developer Program ($99/yr), add `"identity"` and `"hardenedRuntime": true` to `build.mac`, configure notarization via `electron-notarize`
4. Store signing secrets as environment variables in CI/CD (GitHub Actions secrets if using `.github/` workflows)

**Relevant Context:**
- `package.json:41-65` — win/mac build config blocks
- `.github/` — GitHub Actions workflows already exist; extend for signing

---

### Sub-Task 2.2 — Implement Auto-Updates (electron-updater)

**Status:** [ ] pending

**Intent:** There is no update mechanism. Once a user installs a version, they are permanently stuck on it unless they manually reinstall. For a paid product, you need the ability to push bug fixes, security patches, and new features.

**Expected Outcomes:**
- `electron-updater` integrated
- On app startup, app silently checks for updates and notifies the user if one is available
- Update is downloaded and applied on next restart

**Todo List:**
1. `npm install electron-updater`
2. Configure a publish target in `package.json` `build` block (GitHub Releases is simplest: `"publish": { "provider": "github", "owner": "your-username", "repo": "moodbot" }`)
3. Add auto-update logic to `main.js` inside `app.whenReady()`
4. Add IPC handler so renderer can display update status to user
5. Test by building two versions and confirming the older one updates to the newer one

**Relevant Context:**
- `main.js` — `app.whenReady()` handler where update check should run
- `package.json:20-82` — build configuration block

---

### Sub-Task 2.3 — Fix metadata.json and README

**Status:** [ ] pending

**Intent:** `metadata.json` has the name `"Remix: Remix: Remix: MoodBot"` (an artifact from AI Studio export iterations) and references a `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` that is not reflected in the codebase. `README.md` is a generic Google AI Studio developer template, not a user-facing document. Both should be corrected before any public listing.

**Expected Outcomes:**
- `metadata.json` has clean `"name": "MoodBot"` and accurate description
- `README.md` replaced with a user-facing guide covering: what MoodBot is, installation steps, how to connect to MeetMe, feature overview

**Todo List:**
1. Edit `metadata.json`: set `name` to `"MoodBot"`, remove the `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` capability entry, update description
2. Replace `README.md` with a user-facing document: installation, setup, feature overview, FAQ
3. Optionally add a `CHANGELOG.md` for version history

**Relevant Context:**
- `metadata.json` — stale metadata file
- `README.md` — current developer-facing template

---

## Tier 3 — License/Auth System (When Ready to Sell)

---

### Sub-Task 3.1 — Design and Implement License Validation

**Status:** [ ] pending

**Intent:** There is currently zero licensing/auth infrastructure. Before charging money for MoodBot, you need a system to validate that users have paid. This sub-task covers the architecture and implementation of a license key system.

**Expected Outcomes:**
- App checks a license key on startup against a hosted validation endpoint
- Invalid/missing license key shows a "purchase required" screen in the renderer
- License key is stored encrypted using `safeStorage` (built during Sub-Task 1.3)
- Grace period allows the app to work offline for N days after last successful validation

**Todo List:**
1. Choose a license management service (Gumroad, Lemon Squeezy, Stripe + custom, or Keygen.sh)
2. Create a hosted API endpoint (or use provider's API) that accepts `POST /validate-license { key, machineId }` and returns `{ valid, plan, expiresAt }`
3. In `main.js`, add `ipcMain.handle('license:validate', ...)` that calls the endpoint, caches result to safeStorage with timestamp, and returns validity
4. In `main.js`, add `ipcMain.handle('license:activate', ...)` for first-time key entry
5. In `preload.cjs`, expose `validateLicense` and `activateLicense`
6. In React renderer, wrap the main UI in a `<LicenseGate>` component that shows an activation screen if license is not valid
7. Implement machine fingerprinting (use Electron's `app.getPath('userData')` + `os.hostname()` hashed) for per-machine license enforcement

**Relevant Context:**
- Sub-Task 1.3 must be complete first (safeStorage infrastructure needed)
- `preload.cjs` — existing contextBridge to extend
- `main.js` — ipcMain handlers location
- `src/App.tsx` — top-level component where LicenseGate should wrap the app

---

### Sub-Task 3.2 — Add Payment/Purchase Flow

**Status:** [ ] pending

**Intent:** Users need a way to buy a license without leaving the app (or via a clear external link). This sub-task covers the in-app purchase/activation UX.

**Expected Outcomes:**
- App shows a "Buy MoodBot" button that opens the purchase URL in the system browser
- After purchase, user receives a license key they paste into the app's activation screen
- Activation screen validates the key and unlocks the app

**Todo List:**
1. Choose a storefront (Gumroad, Lemon Squeezy, or custom Stripe checkout) and create a product listing
2. In the license gate UI (from 3.1), add a "Purchase MoodBot" button that calls `shell.openExternal(purchaseUrl)` via IPC
3. Add a license key input field and "Activate" button in the gate UI
4. Wire up to `license:activate` IPC handler
5. On successful activation, dismiss the gate and show the main app

**Relevant Context:**
- Sub-Task 3.1 must be complete first
- Electron `shell.openExternal()` — appropriate for opening payment URLs from main process

---

## Issue Summary Table

| # | Issue | Tier | Category |
|---|-------|------|----------|
| 1.1 | `sandbox: false` in main window and WebContentsView | Blocker | Security |
| 1.2 | DevTools not disabled in packaged builds | Blocker | Security |
| 1.3 | MeetMe credentials stored as plaintext in localStorage | Blocker | Security |
| 1.4 | Hardcoded Base64 Authorization header — unverified | Blocker | Security |
| 1.5 | Sourcemaps not disabled in production build | Blocker | IP Protection |
| 1.6 | `express` and `dotenv` unused but in production deps | Blocker | Hygiene |
| 2.1 | No code signing (Windows SmartScreen, macOS Gatekeeper) | Should Fix | Distribution |
| 2.2 | No auto-update mechanism | Should Fix | Distribution |
| 2.3 | Stale metadata.json and developer-facing README | Should Fix | Presentation |
| 3.1 | No license validation system | When selling | Monetization |
| 3.2 | No payment/purchase flow | When selling | Monetization |
