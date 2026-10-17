/**
 * Real-Debrid "Apple" streams for iOS.
 *
 * Real-Debrid can serve any file it hosts as an HLS stream transcoded to
 * H.264 + AAC (its "apple" format), which iOS plays natively. That turns the
 * sources iPad's player cannot open (MKV, x265/HEVC 10-bit, DTS/TrueHD) into
 * playable ones, with no native player in the app.
 *
 * Works for any link that ends up on a Real-Debrid download host, including
 * links handed out by AIOStreams: redirects are followed natively to find the
 * download id, then the transcode endpoint is asked for the HLS playlist.
 */
import { invoke } from "@tauri-apps/api/core";

const API = "https://api.real-debrid.com/rest/1.0";
const RD_DOWNLOAD_HOST = /(^|\.)(download\.)?real-debrid\.(com|cloud|it|fr)$|(^|\.)rdeb\.io$/i;

type NativeFetchResponse = { status: number; ok: boolean; body: string; url?: string | null };

function nativeFetch(url: string, init: { method?: string; headers?: Record<string, string> }) {
  return invoke<NativeFetchResponse>("compass_fetch", {
    args: {
      url,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      timeoutMs: 15000,
      followRedirects: true,
      maxResponseBytes: 512 * 1024,
    },
  });
}

/** The `<id>` in https://<host>.download.real-debrid.com/d/<id>/<file>. */
export function rdDownloadId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!RD_DOWNLOAD_HOST.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/d\/([A-Za-z0-9]+)(?:\/|$)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Follows redirects (AIOStreams playback links, short links) to the final URL. */
async function finalUrl(url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const head = await nativeFetch(url, { method: "HEAD", headers });
    if (head.url) return head.url;
  } catch {
    /* some hosts reject HEAD */
  }
  try {
    const get = await nativeFetch(url, { headers: { ...(headers ?? {}), Range: "bytes=0-0" } });
    return get.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns Real-Debrid's iOS-playable HLS URL for a source, or null when the
 * source is not on Real-Debrid, the key is missing, or RD has no transcode.
 */
export async function realDebridAppleStream(
  apiKey: string,
  url: string,
  headers?: Record<string, string>,
): Promise<string | null> {
  if (!apiKey || !url || !/^https?:\/\//i.test(url)) return null;
  let id = rdDownloadId(url);
  if (!id) {
    const resolved = await finalUrl(url, headers);
    try {
      console.warn(`[rd-transcode] link resolves to ${resolved ? new URL(resolved).host : "nothing"}`);
    } catch {
      /* not a URL */
    }
    id = resolved ? rdDownloadId(resolved) : null;
  }
  console.warn(`[rd-transcode] download id ${id ?? "not found (not a Real-Debrid link)"}`);
  if (!id) return null;
  try {
    const res = await nativeFetch(`${API}/streaming/transcode/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`[rd-transcode] ${res.status} for ${id}`);
      return null;
    }
    const data = JSON.parse(res.body) as Record<string, Record<string, string> | undefined>;
    const apple = data.apple?.full ?? Object.values(data.apple ?? {})[0];
    const fallback = data.liveMP4?.full ?? Object.values(data.liveMP4 ?? {})[0];
    return apple || fallback || null;
  } catch (e) {
    console.warn("[rd-transcode] failed", e);
    return null;
  }
}
