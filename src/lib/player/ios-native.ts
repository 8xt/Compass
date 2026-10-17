/**
 * PlayerBridge for the iOS native player (VLC, src-tauri/plugins/ios-media).
 *
 * The iOS counterpart of the desktop mpv bridge: video renders in a native view
 * under the transparent web view, and this bridge drives it through the
 * `ios_media` command. Used for everything WebKit's <video> cannot play (MKV,
 * x265/HEVC 10-bit, DTS/TrueHD, AVI...), either chosen up front or as the
 * automatic fallback when the HTML5 player fails to decode a source.
 */
import { invoke } from "@tauri-apps/api/core";
import { iosGetVolume, iosSetVolume } from "@/lib/ios-media";
import {
  initialPlayerSnapshot,
  type PlayerBridge,
  type PlayerCapabilities,
  type PlayerSnapshot,
  type PlayerSource,
  type TrackInfo,
} from "./bridge";

type NativeTrack = { index: number; name: string; selected: boolean };
type NativeState = {
  state?: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  time?: number;
  length?: number;
  buffering?: boolean;
  rate?: number;
  width?: number;
  height?: number;
  audio?: NativeTrack[];
  subs?: NativeTrack[];
  error?: string;
};

type ExternalSub = { id: string; url: string; lang?: string; title?: string; added: boolean };

function call<T = unknown>(action: string, args?: Record<string, unknown>): Promise<T | null> {
  return invoke<T>("ios_media", { action, args: args ?? {} }).catch((e) => {
    console.warn(`[ios-native] ${action} failed`, e);
    return null;
  });
}

const POLL_MS = 250;

export function createIosNativeBridge(): PlayerBridge {
  let snap: PlayerSnapshot = initialPlayerSnapshot();
  const listeners = new Set<(s: PlayerSnapshot) => void>();
  let pollTimer: number | null = null;
  let loaded = false;
  let externalSubs: ExternalSub[] = [];
  let selectedSubId: string | null = null;
  let lastSubId: string | null = null;
  let volumeSetAt = 0;
  let pollCount = 0;

  const emit = () => {
    const copy = { ...snap };
    for (const l of listeners) l(copy);
  };

  const subtitleTracks = (native: NativeTrack[] | undefined): TrackInfo[] => {
    const embedded: TrackInfo[] = (native ?? [])
      .filter((t) => t.index >= 0)
      .map((t) => ({
        id: `vlc:${t.index}`,
        label: t.name,
        kind: "subtitle" as const,
        selected: t.selected && selectedSubId === `vlc:${t.index}`,
      }));
    const ext: TrackInfo[] = externalSubs
      .filter((s) => !s.added)
      .map((s) => ({
        id: s.id,
        label: s.title || s.lang || "Subtitle",
        lang: s.lang,
        kind: "subtitle" as const,
        external: true,
        url: s.url,
        selected: selectedSubId === s.id,
      }));
    return [...embedded, ...ext];
  };

  const poll = async () => {
    const st = await call<NativeState>("playerState");
    if (!st || !loaded) return;
    pollCount += 1;
    const time = st.time ?? 0;
    const length = st.length ?? 0;
    const width = st.width ?? 0;
    const height = st.height ?? 0;
    snap.positionSec = time;
    snap.durationSec = length;
    snap.bufferedSec = 0;
    snap.buffering = !!st.buffering;
    snap.rate = st.rate ?? snap.rate;
    snap.videoWidth = width;
    snap.videoHeight = height;
    if (width > 0 && (time > 0 || st.state === "playing")) snap.firstFrameReady = true;
    snap.audioTracks = (st.audio ?? [])
      .filter((t) => t.index >= 0)
      .map((t) => ({
        id: `vlc:${t.index}`,
        label: t.name,
        kind: "audio" as const,
        selected: t.selected,
      }));
    snap.subtitleTracks = subtitleTracks(st.subs);
    if (st.state === "error") {
      snap.status = "error";
      snap.errorCode = "source";
      snap.errorMessage = st.error || "The native player could not open this source.";
    } else if (st.state === "ended") {
      snap.status = "ended";
    } else if (st.state === "playing") {
      snap.status = "playing";
    } else if (st.state === "paused") {
      snap.status = "paused";
    } else {
      snap.status = "loading";
    }
    // Mirror the system volume about once a second (hardware buttons).
    if (pollCount % 4 === 0 && Date.now() - volumeSetAt > 800) {
      const v = await iosGetVolume();
      if (v != null && Date.now() - volumeSetAt > 800) snap.volume = v;
    }
    emit();
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = window.setInterval(() => void poll(), POLL_MS);
  };
  const stopPolling = () => {
    if (pollTimer != null) window.clearInterval(pollTimer);
    pollTimer = null;
  };

  const headerValue = (headers: Record<string, string> | undefined, name: string) => {
    if (!headers) return undefined;
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key ? headers[key] : undefined;
  };

  const selectExternal = async (sub: ExternalSub) => {
    await call("playerAddSubtitle", { url: sub.url, select: true });
    sub.added = true;
  };

  const setSubtitleTrack = (id: string | null) => {
    if (id) lastSubId = id;
    selectedSubId = id;
    if (!id) {
      void call("playerSubtitleTrack", { index: -1 });
      return;
    }
    if (id.startsWith("vlc:")) {
      void call("playerSubtitleTrack", { index: Number(id.slice(4)) });
      return;
    }
    const ext = externalSubs.find((s) => s.id === id);
    if (ext) void selectExternal(ext);
  };

  return {
    attach() {
      /* the native view lives under the web view; nothing to mount in the DOM */
    },
    detach() {
      stopPolling();
    },
    async load(src: PlayerSource) {
      loaded = true;
      pollCount = 0;
      externalSubs = (src.subtitles ?? []).map((s, i) => ({
        id: s.id ? `ext:${s.id}` : `ext:${i}`,
        url: s.url,
        lang: s.lang,
        added: false,
      }));
      selectedSubId = null;
      snap = {
        ...snap,
        status: "loading",
        positionSec: 0,
        durationSec: 0,
        bufferedSec: 0,
        buffering: true,
        firstFrameReady: false,
        audioTracks: [],
        subtitleTracks: subtitleTracks([]),
        errorCode: null,
        errorMessage: null,
        subText: "",
      };
      emit();
      const r = await call<{ ok?: boolean; error?: string }>("playerLoad", {
        url: src.url,
        startSec: src.startAtSec ?? 0,
        userAgent: headerValue(src.headers, "user-agent"),
        referrer: headerValue(src.headers, "referer"),
      });
      if (r && r.ok === false) {
        snap.status = "error";
        snap.errorCode = "source";
        snap.errorMessage = r.error ?? "The native player could not start.";
        emit();
        return;
      }
      const v = await iosGetVolume();
      if (v != null) snap.volume = v;
      startPolling();
    },
    async play() {
      await call("playerPlay");
    },
    pause() {
      void call("playerPause");
    },
    seek(sec) {
      snap.positionSec = Math.max(0, sec);
      emit();
      void call("playerSeek", { value: Math.max(0, sec) });
    },
    setVolume(v) {
      const clamped = Math.max(0, Math.min(1, v));
      volumeSetAt = Date.now();
      snap.volume = clamped;
      iosSetVolume(clamped);
      emit();
    },
    setMuted(m) {
      snap.muted = m;
      void call("playerMute", { value: m ? 1 : 0 });
      emit();
    },
    setRate(r) {
      snap.rate = r;
      void call("playerRate", { value: r });
      emit();
    },
    setAudioTrack(id) {
      const index = Number(id.replace(/^vlc:/, ""));
      if (Number.isFinite(index)) void call("playerAudioTrack", { index });
    },
    setSubtitleTrack,
    setSecondarySubtitleTrack() {
      /* not supported by the native player */
    },
    setSubVisible(on) {
      if (!on) void call("playerSubtitleTrack", { index: -1 });
      else if (lastSubId) setSubtitleTrack(lastSubId);
    },
    setSubDelay(sec) {
      snap.subDelaySec = sec;
      void call("playerSubDelay", { value: sec });
      emit();
    },
    setAudioDelay(sec) {
      snap.audioDelaySec = sec;
      void call("playerAudioDelay", { value: sec });
      emit();
    },
    setPanscan() {},
    setVideoZoom() {},
    setAspectOverride() {},
    setStretch() {},
    setVideoEq() {},
    setAnime4kShaders() {},
    async addSubtitle(url, lang, title, select) {
      const sub: ExternalSub = {
        id: `ext:add:${externalSubs.length}:${url.length}`,
        url,
        lang,
        title,
        added: false,
      };
      externalSubs.push(sub);
      if (select) {
        selectedSubId = sub.id;
        lastSubId = sub.id;
        await selectExternal(sub);
      }
      return true;
    },
    getSelectedTrackCues() {
      return null;
    },
    getSelectedTrackUrl() {
      return externalSubs.find((s) => s.id === selectedSubId)?.url ?? null;
    },
    setAudioNormalize(on) {
      snap.audioNormalize = on;
    },
    async screenshot() {
      return { ok: false, error: "Screenshots are not available on iOS" };
    },
    setAbLoop() {},
    async requestPiP() {},
    async exitPiP() {},
    async requestFullscreen() {},
    async exitFullscreen() {},
    capabilities(): PlayerCapabilities {
      return {
        engine: "mpv",
        pictureInPicture: false,
        airplay: false,
        chromecast: false,
        hdrPassthrough: false,
        hardwareDecode: true,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...snap });
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      loaded = false;
      stopPolling();
      listeners.clear();
      void call("playerStop");
    },
  };
}
