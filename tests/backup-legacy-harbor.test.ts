// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

type BackupModule = typeof import("../src/lib/backup");

// Execute the real backup module with the native boundaries mocked, matching
// tests/backup-pick.test.ts.
function loadBackup(overrides: Record<string, unknown>): BackupModule {
  const empty = {};
  const mocks: Record<string, unknown> = {
    "@/lib/download-text": empty,
    "@/lib/profile-sync/backup-payload": { buildSyncBackup: () => ({}) },
    "@/lib/theme-storage": empty,
    "@/lib/profiles": { readAllProfilesIdentity: () => [] },
    "@/lib/active-profile-id": { activeProfileId: () => "local" },
    "@/lib/secret-store": empty,
    "@/lib/storage-recovery": empty,
    "@/lib/local-library": empty,
    ...overrides,
  };
  const source = readFileSync(new URL("../src/lib/backup.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name: string) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected native boundary: ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return module.exports as BackupModule;
}

test("legacy harbor-backup files parse and their keys are renamed", () => {
  const backup = loadBackup({});
  const text = JSON.stringify({
    format: "harbor-backup",
    version: 1,
    app: "0.9.132",
    exportedAt: "2026-10-15T00:00:00.000Z",
    data: {
      "harbor.settings": '{"tmdbKey":"abc"}',
      "harbor.settings.shared": "{}",
      "harbor.manga.langfilter.v1": "[]",
      "harbor.auth.p_mqxx2agk_ez1zro": '{"authKey":"secret"}',
      "harbor.update.enrolled": "1",
      "harbor-spookfest-list": "[]",
    },
  });
  const parsed = backup.parseBackup(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.backup.format, "compass-backup");
  // compass.auth.* and compass.update.* are not portable, and bare
  // compass-* names never were; the rest land on their Compass names.
  assert.deepEqual(Object.keys(parsed.backup.data).sort(), [
    "compass.manga.langfilter.v1",
    "compass.settings",
    "compass.settings.shared",
  ]);
  assert.equal(parsed.backup.data["compass.settings"], '{"tmdbKey":"abc"}');
});

test("compass-backup files are unaffected", () => {
  const backup = loadBackup({});
  const parsed = backup.parseBackup(
    JSON.stringify({
      format: "compass-backup",
      version: 1,
      app: "0.9.132",
      exportedAt: "2026-10-15T00:00:00.000Z",
      data: { "compass.settings": "{}" },
    }),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(Object.keys(parsed.backup.data), ["compass.settings"]);
});

test("other formats are still rejected", () => {
  const backup = loadBackup({});
  const parsed = backup.parseBackup(
    JSON.stringify({ format: "something-else", version: 1, app: "x", exportedAt: "", data: { "compass.settings": "{}" } }),
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.error, "This is not a Compass backup file.");
});

test("renameHarborKey follows the fork's rename rules", () => {
  const backup = loadBackup({});
  assert.equal(backup.renameHarborKey("harbor.settings"), "compass.settings");
  assert.equal(backup.renameHarborKey("harbor-spookfest-list"), "compass-spookfest-list");
  assert.equal(backup.renameHarborKey("harborAvatar"), "compassAvatar");
  assert.equal(backup.renameHarborKey("compass.settings"), "compass.settings");
  assert.equal(backup.renameHarborKey("harborous"), "harborous");
});
