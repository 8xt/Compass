#!/usr/bin/env node
/*
 * migrate-from-harbor.mjs — one-shot migration of an existing Harbor (beta)
 * installation into Compass on the same machine. Run with both apps closed.
 *
 * Fill-missing-only and idempotent. What it migrates:
 *   - settings.json        keys Compass lacks, with brand renames (harbor* -> compass*)
 *   - secrets.json         renames harbor.* -> compass.* and merges
 *   - user data dirs/files fonts, games, manga, music, spotify, connectors, ...
 *   - localStorage         Harbor's WebView2 LevelDB, ORIGIN BY ORIGIN:
 *                            http://localhost:1420   (dev)  -> same origin in Compass
 *                            http://tauri.localhost  (release) -> same origin in Compass
 *                          so dev and release data never mix. Big caches are skipped
 *                          unless --include-caches is passed.
 *   - migration record     %APPDATA%/app.compass/migrate-from-harbor.json
 *
 * It never writes to the Harbor side. Everything it modifies is backed up
 * first under %APPDATA%/app.compass/.harbor-migration-backup-<timestamp>/.
 *
 * Usage:  node migrate-from-harbor.mjs [--apply] [--include-caches]
 */
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from "node:fs";

let ClassicLevel;
try {
  ({ ClassicLevel } = await import("classic-level"));
} catch {
  console.error("[migrate] the 'classic-level' dependency is not installed. Run: pnpm install");
  process.exit(1);
}
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";

const APPLY = process.argv.includes("--apply");
const INCLUDE_CACHES = process.argv.includes("--include-caches");
const ts = new Date().toISOString().replace(/[:.]/g, "-");

// ---------------------------------------------------------------- paths
function roaming(id) {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", id);
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), id);
}
function local(id) {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), id);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", id);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id);
}

const SRC_ROAMING = roaming("app.harbor");
const DST_ROAMING = roaming("app.compass");
const SRC_LS = join(local("app.harbor"), "EBWebView", "Default", "Local Storage", "leveldb");
const DST_LS = join(local("app.compass"), "EBWebView", "Default", "Local Storage", "leveldb");
const BACKUP = join(DST_ROAMING, `.harbor-migration-backup-${ts}`);

const APP_ORIGINS = ["http://localhost:1420", "http://tauri.localhost"];
const CACHE_PREFIXES = [
  "harbor.manga.art.", "harbor.manga.cache.", "harbor.anime.art.", "harbor.anime.hero.",
  "harbor.anime.herologos.", "harbor.anime.toppicks.", "harbor.ebook.openlibrary.",
  "harbor.tvdbo.", "harbor.cinemeta.meta.", "harbor.sample-poster.v1.",
];
// Keys where Harbor's value wins over what Compass already has: identity and first-run
// state that Compass created fresh on its own first launch (fill-missing would keep
// the blank copies and you would appear signed out, mid-tutorial).
const OVERRIDE_EXACT = new Set(["compass.profiles.v1", "compass.onboarding", "compass.settings", "compass.settingsNew.v1"]);
const OVERRIDE_PREFIXES = ["compass.onboarding.", "compass.auth.", "compass.settings.", "compass.settingsNewSeen"];

// ---------------------------------------------------------------- copy plan
const COPY_DIRS = [
  "fonts", "anime4k", "shaders",
  "games", "game-accounts", "game-download-queue", "game-preparation", "game-setup", "game-torrents", "game-archives",
  "manga-downloads", "music", "music-store", "spotify", "connectors",
];
const COPY_FILES = [".window-state.json", "soundcloud-client-id", "youtube-visitor-id", "music-audio.json"];
const SKIP_NOTE = {
  capstan: "staged extension runtime (rebuildable)",
  "crash-recovery": "transient", "update-recovery": "transient",
  "extension-archives": "extension layer cache", xray: "runtime",
  "harbor-subs": "subtitle cache", "subtitle-cache.json": "subtitle cache",
  "harbor-mpv.log": "log file", ytmusic: "cache",
};

const report = { generated: new Date().toISOString(), apply: APPLY, source: SRC_ROAMING, target: DST_ROAMING, warnings: [], steps: [] };
const log = (...a) => console.log(...a);

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function atomicWrite(p, text) {
  const tmp = `${p}.tmp-${ts}`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}
function cpFile(src, dst) { mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); }

/** Mirrors the fork's textual rebrand for key names: harbor(X) -> compass(X). */
function renameBrand(s) {
  if (/^harbor([.\-]|[A-Z])/.test(s)) return `compass${s.slice(6)}`;
  return s;
}

// ---------------------------------------------------------------- settings
function migrateSettings() {
  const src = readJson(join(SRC_ROAMING, "settings.json"));
  const dstPath = join(DST_ROAMING, "settings.json");
  const dst = readJson(dstPath) ?? {};
  if (!src) return { status: "source missing or unreadable" };
  const added = [], overwritten = [], renamed = [];
  for (const k of Object.keys(src)) {
    const nk = renameBrand(k);
    const has = Object.prototype.hasOwnProperty.call(dst, nk);
    if (has && JSON.stringify(dst[nk]) === JSON.stringify(src[k])) continue;
    dst[nk] = src[k]; // Harbor wins on conflicts; Compass-only keys stay untouched
    if (has) overwritten.push(k);
    else added.push(nk);
    if (nk !== k) renamed.push(`${k} -> ${nk}`);
  }
  if (APPLY && (added.length || overwritten.length)) {
    if (existsSync(dstPath)) cpFile(dstPath, join(BACKUP, "settings.json"));
    atomicWrite(dstPath, JSON.stringify(dst));
  }
  return { status: APPLY ? "merged" : "dry-run", sourceKeys: Object.keys(src).length, added: added.length, overwritten: overwritten.length, overwrittenSample: overwritten.slice(0, 14), renamed, sample: added.slice(0, 12) };
}

// ---------------------------------------------------------------- secrets
function migrateSecrets() {
  const src = readJson(join(SRC_ROAMING, "secrets.json"));
  const dstPath = join(DST_ROAMING, "secrets.json");
  const dst = readJson(dstPath) ?? {};
  if (!src) return { status: "source missing or unreadable" };
  const renamed = [], added = [], kept = [];
  for (const [k, v] of Object.entries(src)) {
    const nk = renameBrand(k);
    if (nk in dst) { kept.push(nk); continue; }
    dst[nk] = v;
    (nk === k ? added : renamed).push(`${k} -> ${nk}`);
  }
  if (APPLY && (renamed.length || added.length)) {
    if (existsSync(dstPath)) cpFile(dstPath, join(BACKUP, "secrets.json"));
    atomicWrite(dstPath, JSON.stringify(dst));
  }
  return { status: APPLY ? "merged" : "dry-run", total: Object.keys(src).length, renamed, added, kept };
}

// ---------------------------------------------------------------- dirs/files
function copyMissingTree(srcDir, dstDir) {
  let copied = 0, present = 0;
  const walk = (rel) => {
    for (const e of readdirSync(join(srcDir, rel), { withFileTypes: true })) {
      const r = join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      if (!e.isFile()) continue;
      const dd = join(dstDir, r);
      if (existsSync(dd)) { present++; continue; }
      if (APPLY) cpFile(join(srcDir, r), dd);
      copied++;
    }
  };
  walk(".");
  return { copied, present };
}
function migrateDirs() {
  const dirs = {}, files = {};
  for (const d of COPY_DIRS) {
    const sd = join(SRC_ROAMING, d);
    if (!existsSync(sd)) { dirs[d] = "not in source"; continue; }
    dirs[d] = copyMissingTree(sd, join(DST_ROAMING, d));
  }
  for (const f of COPY_FILES) {
    const sf = join(SRC_ROAMING, f);
    if (!existsSync(sf)) { files[f] = "not in source"; continue; }
    const df = join(DST_ROAMING, f);
    if (existsSync(df)) { files[f] = "present (skipped)"; continue; }
    if (APPLY) cpFile(sf, df);
    files[f] = "copied";
  }
  for (const name of readdirSync(SRC_ROAMING)) {
    if (!/^music-p_.*\.db$/.test(name)) continue;
    const df = join(DST_ROAMING, name);
    if (existsSync(df)) { files[name] = "present (skipped)"; continue; }
    if (APPLY) cpFile(join(SRC_ROAMING, name), df);
    files[name] = "copied";
  }
  const musicDb = join(DST_ROAMING, "music.db");
  const musicState = existsSync(musicDb)
    ? { "music.db": "present (skipped; cannot merge sqlite)" }
    : Object.fromEntries(["music.db", "music.db-wal", "music.db-shm"]
        .filter((n) => existsSync(join(SRC_ROAMING, n)))
        .map((n) => { if (APPLY) cpFile(join(SRC_ROAMING, n), join(DST_ROAMING, n)); return [n, "copied"]; }));
  return { dirs, files, musicState };
}
function skippedItems() {
  const out = {};
  for (const name of readdirSync(SRC_ROAMING)) {
    if (SKIP_NOTE[name]) out[name] = SKIP_NOTE[name];
    else if (/^capstan-backup-/.test(name)) out[name] = "capstan backup";
  }
  return out;
}

// ---------------------------------------------------------------- localStorage
// Chromium Local Storage LevelDB format:
//   key   = "_" + origin + "\x00" + tagged(name)
//   value = tagged(value)
//   tagged(s) = [0x00][utf16le bytes] | [0x01][one-byte/latin1 bytes]
const BUF = { keyEncoding: "buffer", valueEncoding: "buffer" };
function decodeTagged(buf) {
  if (buf.length && (buf[0] === 0 || buf[0] === 1)) {
    const tag = buf[0];
    const rest = buf.subarray(1);
    return rest.toString(tag === 0 ? "utf16le" : "latin1");
  }
  return buf.toString("utf8");
}
function encodeTagged(str) {
  for (const ch of str) if (ch.codePointAt(0) > 0xff) return Buffer.concat([Buffer.from([0]), Buffer.from(str, "utf16le")]);
  return Buffer.concat([Buffer.from([1]), Buffer.from(str, "latin1")]);
}
function decodeEntry(key, val) {
  if (!key || key.length < 3 || key[0] !== 0x5f) return null;
  const nul = key.indexOf(0, 1);
  if (nul <= 1) return null;
  return {
    origin: key.subarray(1, nul).toString("utf8"),
    name: decodeTagged(key.subarray(nul + 1)),
    value: decodeTagged(val),
  };
}
function encodeEntry(origin, name, value) {
  return {
    key: Buffer.concat([Buffer.from(`_${origin}\u0000`, "utf8"), encodeTagged(name)]),
    value: encodeTagged(value),
  };
}
function snapshotDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (!e.isFile() || e.name === "LOCK") continue;
    copyFileSync(join(src, e.name), join(dst, e.name));
  }
}
async function readLs(dir) {
  const entries = new Map();
  const db = new ClassicLevel(dir, { createIfMissing: false, ...BUF });
  await db.open();
  try {
    for await (const [k, v] of db.iterator(BUF)) {
      const d = decodeEntry(k, v);
      if (d) entries.set(`${d.origin}\u0000${d.name}`, d);
    }
  } finally {
    await db.close();
  }
  return entries;
}

async function migrateLocalStorage() {
  const out = { status: "dry-run", perOrigin: {} };
  if (!existsSync(SRC_LS)) { out.status = "no harbor profile"; return out; }
  const snapH = join(tmpdir(), `harbor-ls-snapshot-${ts}`);
  const snapC = join(tmpdir(), `compass-ls-snapshot-${ts}`);
  snapshotDir(SRC_LS, snapH);
  if (existsSync(DST_LS)) snapshotDir(DST_LS, snapC);

  const hAll = await readLs(snapH);
  const cAll = existsSync(snapC) ? await readLs(snapC) : new Map();
  const appSet = new Set(APP_ORIGINS);
  const hApp = [...hAll.values()].filter((e) => appSet.has(e.origin));
  const foreign = {};
  for (const e of hAll.values()) if (!appSet.has(e.origin)) foreign[e.origin] = (foreign[e.origin] ?? 0) + 1;
  out.foreignOrigins = foreign;

  const plan = [], renamed = [], skippedExisting = [], skippedCache = [];
  for (const origin of APP_ORIGINS) {
    const stat = { found: 0, toWrite: 0, bytes: 0, renamed: 0, skippedExisting: 0, skippedCache: 0, overwritten: 0 };
    for (const e of hApp.filter((x) => x.origin === origin)) {
      stat.found++;
      if (!INCLUDE_CACHES && CACHE_PREFIXES.some((p) => e.name.startsWith(p))) {
        stat.skippedCache++;
        skippedCache.push(`${origin} | ${e.name}`);
        continue;
      }
      const nk = renameBrand(e.name);
      const override = OVERRIDE_EXACT.has(nk) || OVERRIDE_PREFIXES.some((p) => nk.startsWith(p));
      if (cAll.has(`${origin}\u0000${nk}`)) {
        if (!override) {
          stat.skippedExisting++;
          skippedExisting.push(`${origin} | ${nk}`);
          continue;
        }
        stat.overwritten++;
      }
      plan.push({ origin, name: nk, value: e.value });
      stat.toWrite++;
      stat.bytes += e.value.length;
      if (nk !== e.name) { stat.renamed++; renamed.push(`${e.name} -> ${nk}`); }
      out.perOrigin[origin] = stat;
    }
    out.perOrigin[origin] = stat;
  }
  plan.sort((a, b) => a.value.length - b.value.length); // smallest first: best chance under quota
  out.toWrite = plan.length;
  out.bytes = plan.reduce((t, p) => t + p.value.length, 0);
  out.renamed = renamed;
  out.skippedExisting = skippedExisting;
  out.skippedCache = skippedCache;

  if (APPLY && plan.length) {
    snapshotDir(DST_LS, join(BACKUP, "LocalStorage-leveldb"));
    mkdirSync(DST_LS, { recursive: true });
    let written = 0, failed = 0;
    const db = new ClassicLevel(DST_LS, { ...BUF });
    await db.open();
    try {
      for (const p of plan) {
        try { const enc = encodeEntry(p.origin, p.name, p.value); await db.put(enc.key, enc.value, BUF); written++; }
        catch { failed++; }
      }
    } finally {
      await db.close();
    }
    let present = 0;
    const check = new ClassicLevel(DST_LS, { createIfMissing: false, ...BUF });
    await check.open();
    try {
      for (const p of plan) {
        const enc = encodeEntry(p.origin, p.name, p.value);
        if ((await check.get(enc.key, BUF)) !== undefined) present++;
      }
    } finally {
      await check.close();
    }
    out.status = "applied";
    out.written = written;
    out.failed = failed;
    out.verified = `${present}/${plan.length}`;
    const audit = {};
    for (const p of plan) {
      audit[p.origin] = audit[p.origin] ?? {};
      audit[p.origin][p.name] = p.value;
    }
    atomicWrite(join(DST_ROAMING, "migrate-from-harbor.json"), JSON.stringify({
      version: 1, created: new Date().toISOString(), source: "localStorage", origins: audit,
    }));
  }
  return out;
}

// ---------------------------------------------------------------- run
log(`== migrate-from-harbor ${APPLY ? "(APPLY)" : "(DRY RUN — no changes; rerun with --apply)"} ==`);
log(`source: ${SRC_ROAMING}`);
log(`target: ${DST_ROAMING}`);
if (!existsSync(SRC_ROAMING)) { console.error("No %APPDATA%/app.harbor found — nothing to migrate."); process.exit(1); }
if (APPLY) mkdirSync(BACKUP, { recursive: true });

report.steps.push({ name: "settings", ...migrateSettings() });
report.steps.push({ name: "secrets", ...migrateSecrets() });
report.steps.push({ name: "dirs-and-files", ...migrateDirs() });
report.steps.push({ name: "deliberately-skipped", items: skippedItems() });
try {
  report.steps.push({ name: "localStorage", ...(await migrateLocalStorage()) });
} catch (err) {
  report.warnings.push(`localStorage: ${err && err.message ? err.message : String(err)}`);
}
if (APPLY) atomicWrite(join(BACKUP, "report.json"), JSON.stringify(report, null, 2));

// ---------------------------------------------------------------- summary
for (const s of report.steps) {
  if (s.name === "settings") log(`[settings]  ${s.status}: ${s.added ?? 0} keys added, ${s.overwritten ?? 0} values overwritten from Harbor (source had ${s.sourceKeys ?? 0})${s.renamed?.length ? `, renamed: ${s.renamed.join(", ")}` : ""}${s.overwrittenSample?.length ? `\n            overwritten: ${s.overwrittenSample.join(", ")}` : ""}${s.sample?.length ? `\n            added: ${s.sample.join(", ")}` : ""}`);
  else if (s.name === "secrets") log(`[secrets]   ${s.status}: ${s.total ?? 0} found, ${s.renamed?.length ?? 0} renamed+added, ${s.added?.length ?? 0} added, ${s.kept?.length ?? 0} already present`);
  else if (s.name === "dirs-and-files") {
    for (const [d, r] of Object.entries(s.dirs)) log(`[dirs]      ${d}: ${typeof r === "string" ? r : `${r.copied} copied, ${r.present} present`}`);
    for (const [f, r] of Object.entries(s.files)) log(`[files]     ${f}: ${r}`);
    for (const [f, r] of Object.entries(s.musicState)) log(`[files]     ${f}: ${r}`);
  } else if (s.name === "deliberately-skipped") log(`[skipped]   ${Object.entries(s.items).map(([k, v]) => `${k} (${v})`).join(", ") || "none"}`);
  else if (s.name === "localStorage") {
    if (s.status === "no harbor profile") log("[localStorage] no Harbor WebView profile found");
    else {
      for (const [origin, st] of Object.entries(s.perOrigin ?? {})) {
        log(`[localStorage] ${origin}: ${st.found} found -> ${APPLY ? "" : "would "}write ${st.toWrite} (${(st.bytes / 1048576).toFixed(1)} MB), ${st.skippedExisting} existing, ${st.overwritten} overwritten, ${st.skippedCache} cache-skipped${st.renamed ? `, ${st.renamed} renamed` : ""}`);
      }
      if (APPLY) log(`[localStorage] written ${s.written}, failed ${s.failed}, verified ${s.verified}`);
      log(`[localStorage] foreign/webview origins left alone: ${Object.entries(s.foreignOrigins ?? {}).map(([o, c]) => `${o} (${c})`).join(", ") || "none"}`);
      if (s.renamed?.length) log(`[localStorage] renamed sample: ${s.renamed.slice(0, 8).join(" | ")}${s.renamed.length > 8 ? ` (+${s.renamed.length - 8} more)` : ""}`);
      if (s.skippedCache?.length) log(`[localStorage] cache-skipped sample: ${s.skippedCache.slice(0, 6).join(" | ")}${s.skippedCache.length > 6 ? ` (+${s.skippedCache.length - 6} more; --include-caches to migrate them too)` : ""}`);
    }
  }
}
for (const w of report.warnings) log(`[warn] ${w}`);
if (APPLY) log(`\nbackups + full report: ${BACKUP}`);
log(APPLY ? "done." : "\nDry run only. Rerun with --apply to execute.");
