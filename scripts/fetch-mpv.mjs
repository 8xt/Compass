import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("[mpv] not Windows, skipping bundled mpv.exe");
  process.exit(0);
}

// Mirrored as a Compass pre-release so setup keeps working when upstream
// rotates old tags away. To bump: upload the new shinchiro mpv 7z builds to a
// Compass release, then update the tag, assets and hashes below.
const RELEASE = "mpv-20261015-git-492bae0768";
const SPECS = {
  x64: {
    asset: "mpv-x86_64-20261015-git-492bae0768.7z",
    sha256: "f9becefe40e2a29d2ce5f3ab231ff094f9cf3e4038ff014cfe4a0c09ad90e79e",
  },
  arm64: {
    asset: "mpv-aarch64-20261015-git-492bae0768.7z",
    sha256: "0084391b2de928bbe8e4667465bd61ca717d0e17ef71cd2fdc37d3d3f180d470",
  },
};

const spec = SPECS[process.arch];
if (!spec) {
  throw new Error(`[mpv] unsupported Windows architecture: ${process.arch}`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(root, "src-tauri", "binaries", "mpv-x86_64-pc-windows-msvc.exe");

if (existsSync(destination) && statSync(destination).size > 0) {
  console.log(`[mpv] ${destination} already present`);
  process.exit(0);
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

const url = `https://github.com/Compasssio/Compass/releases/download/${RELEASE}/${spec.asset}`;
const temp = mkdtempSync(join(tmpdir(), "compass-mpv-"));

try {
  console.log(`[mpv] fetching ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`[mpv] download failed (${response.status} ${response.statusText})`);

  const archive = join(temp, spec.asset);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== spec.sha256) throw new Error(`[mpv] checksum mismatch (expected ${spec.sha256}, got ${digest})`);
  writeFileSync(archive, bytes);

  const extracted = join(temp, "extracted");
  mkdirSync(extracted);
  // Prefer 7-Zip. Windows 10+ also ships bsdtar (`tar`), which reads 7z
  // archives, so fall back to it when 7-Zip is missing or produced nothing.
  try {
    execFileSync("7z", ["x", "-y", archive, `-o${extracted}`], { stdio: "inherit" });
  } catch {}
  let mpv = findFile(extracted, "mpv.exe");
  if (!mpv) {
    try {
      execFileSync("tar", ["-xf", archive, "-C", extracted], { stdio: "inherit" });
    } catch {}
    mpv = findFile(extracted, "mpv.exe");
  }
  if (!mpv) throw new Error("[mpv] extraction failed; install 7-Zip, or ensure `tar` (bsdtar) is on PATH");
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(mpv, destination);
  console.log(`[mpv] wrote ${destination}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
