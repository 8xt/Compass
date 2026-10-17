import Foundation
import MobileVLCKit
import Tauri
import UIKit
import WebKit

// Native video player for iOS (VLC). Plays what WebKit's <video> cannot: MKV,
// x265/HEVC 10-bit, DTS/TrueHD audio, AVI, embedded ASS/PGS subtitles...
//
// Same layout as the desktop app's embedded mpv: the video view sits *under* a
// transparent WKWebView, so the app's own player controls draw on top of it.
// The web side polls `playerState` a few times a second.

class PlayerLoadArgs: Decodable {
  let url: String
  let startSec: Double?
  let userAgent: String?
  let referrer: String?
}

class PlayerNumberArgs: Decodable {
  let value: Double
}

class PlayerTrackArgs: Decodable {
  let index: Int
}

class PlayerSubArgs: Decodable {
  let url: String
  let select: Bool?
}

final class NativePlayer: NSObject, VLCMediaPlayerDelegate {
  static let shared = NativePlayer()

  private var player: VLCMediaPlayer?
  private var videoView: UIView?
  private var lastError: String?
  private var ended = false
  private var everPlayed = false

  private func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    for scene in scenes {
      if let window = scene.windows.first(where: { $0.isKeyWindow }) {
        return window
      }
    }
    return scenes.first?.windows.first
  }

  private func findWebView(in view: UIView) -> WKWebView? {
    if let web = view as? WKWebView { return web }
    for child in view.subviews {
      if let web = findWebView(in: child) { return web }
    }
    return nil
  }

  /// Puts the black video view right under the web view and makes the web view
  /// see-through, so the page decides where the video shows.
  private func ensureView() -> Bool {
    if let view = videoView, view.superview != nil { return true }
    guard let window = keyWindow(), let web = findWebView(in: window), let parent = web.superview
    else { return false }
    let view = UIView(frame: parent.bounds)
    view.backgroundColor = .black
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.isUserInteractionEnabled = false
    parent.insertSubview(view, belowSubview: web)
    web.isOpaque = false
    web.backgroundColor = .clear
    web.scrollView.backgroundColor = .clear
    videoView = view
    return true
  }

  private func makePlayer() -> VLCMediaPlayer {
    if let p = player { return p }
    let p = VLCMediaPlayer()
    p.delegate = self
    player = p
    return p
  }

  func mediaPlayerStateChanged(_ aNotification: Notification) {
    guard let p = player else { return }
    switch p.state {
    case .error:
      lastError = "VLC could not open this source."
    case .ended:
      ended = true
    case .playing:
      everPlayed = true
    default:
      break
    }
  }

  // MARK: commands (always called on the main thread)

  func load(_ args: PlayerLoadArgs) -> [String: Any] {
    guard ensureView() else { return ["ok": false, "error": "no web view"] }
    guard let url = URL(string: args.url) else { return ["ok": false, "error": "bad url"] }
    let p = makePlayer()
    p.stop()
    let media = VLCMedia(url: url)
    media.addOption(":network-caching=4000")
    media.addOption(":http-reconnect")
    if let ua = args.userAgent, !ua.isEmpty { media.addOption(":http-user-agent=\(ua)") }
    if let ref = args.referrer, !ref.isEmpty { media.addOption(":http-referrer=\(ref)") }
    if let start = args.startSec, start > 1 { media.addOption(":start-time=\(start)") }
    lastError = nil
    ended = false
    everPlayed = false
    videoView?.isHidden = false
    p.drawable = videoView
    p.media = media
    p.play()
    return ["ok": true]
  }

  func stop() {
    player?.stop()
    player?.media = nil
    videoView?.isHidden = true
    ended = false
    everPlayed = false
  }

  func play() { player?.play() }
  func pause() { player?.pause() }

  func seek(_ sec: Double) {
    guard let p = player else { return }
    p.time = VLCTime(int: Int32(max(0, sec) * 1000))
    ended = false
  }

  func setRate(_ rate: Double) { player?.rate = Float(rate) }

  func setMuted(_ muted: Bool) { player?.audio?.isMuted = muted }

  func setAudioTrack(_ index: Int) { player?.currentAudioTrackIndex = Int32(index) }

  func setSubtitleTrack(_ index: Int) { player?.currentVideoSubTitleIndex = Int32(index) }

  /// Seconds; VLC takes microseconds.
  func setSubDelay(_ sec: Double) { player?.currentVideoSubTitleDelay = Int(sec * 1_000_000) }
  func setAudioDelay(_ sec: Double) { player?.currentAudioPlaybackDelay = Int(sec * 1_000_000) }

  func addSubtitle(_ args: PlayerSubArgs) -> Bool {
    guard let p = player, let url = URL(string: args.url) else { return false }
    return p.addPlaybackSlave(url, type: .subtitle, enforce: args.select ?? true) == 0
  }

  private func tracks(names: [Any]?, indexes: [Any]?, current: Int32) -> [[String: Any]] {
    let n = names ?? []
    let ix = indexes ?? []
    var out: [[String: Any]] = []
    for i in 0..<min(n.count, ix.count) {
      let index = (ix[i] as? NSNumber)?.intValue ?? -1
      out.append([
        "index": index,
        "name": (n[i] as? String) ?? "Track \(i + 1)",
        "selected": Int32(index) == current,
      ])
    }
    return out
  }

  func state() -> [String: Any] {
    guard let p = player else { return ["state": "idle"] }
    let length = Double(p.media?.length.intValue ?? 0) / 1000
    let time = Double(p.time.intValue) / 1000
    let size = p.videoSize
    var state: String
    switch p.state {
    case .opening: state = "loading"
    case .buffering: state = p.isPlaying ? "playing" : (everPlayed ? "paused" : "loading")
    case .playing: state = "playing"
    case .paused: state = "paused"
    case .ended: state = "ended"
    case .error: state = "error"
    case .stopped: state = ended ? "ended" : (everPlayed ? "paused" : "loading")
    case .esAdded: state = p.isPlaying ? "playing" : "loading"
    @unknown default: state = "loading"
    }
    if ended { state = "ended" }
    if lastError != nil { state = "error" }
    return [
      "state": state,
      "time": time,
      "length": length,
      "buffering": p.state == .buffering || p.state == .opening,
      "rate": Double(p.rate),
      "width": Double(size.width),
      "height": Double(size.height),
      "audio": tracks(names: p.audioTrackNames, indexes: p.audioTrackIndexes, current: p.currentAudioTrackIndex),
      "subs": tracks(names: p.videoSubTitlesNames, indexes: p.videoSubTitlesIndexes, current: p.currentVideoSubTitleIndex),
      "error": lastError ?? "",
    ]
  }
}

// MARK: Tauri command glue (methods on the plugin class, see IosMediaPlugin.swift)

extension IosMediaPlugin {
  private func onMain(_ invoke: Invoke, _ work: @escaping () -> Any?) {
    DispatchQueue.main.async {
      let result = work()
      if let dict = result as? [String: Any] {
        invoke.resolve(dict)
      } else if let ok = result as? Bool {
        invoke.resolve(["ok": ok])
      } else {
        invoke.resolve()
      }
    }
  }

  @objc public func playerLoad(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerLoadArgs.self)
    onMain(invoke) { NativePlayer.shared.load(args) }
  }

  @objc public func playerStop(_ invoke: Invoke) {
    onMain(invoke) { NativePlayer.shared.stop(); return nil }
  }

  @objc public func playerPlay(_ invoke: Invoke) {
    onMain(invoke) { NativePlayer.shared.play(); return nil }
  }

  @objc public func playerPause(_ invoke: Invoke) {
    onMain(invoke) { NativePlayer.shared.pause(); return nil }
  }

  @objc public func playerSeek(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerNumberArgs.self)
    onMain(invoke) { NativePlayer.shared.seek(args.value); return nil }
  }

  @objc public func playerRate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerNumberArgs.self)
    onMain(invoke) { NativePlayer.shared.setRate(args.value); return nil }
  }

  @objc public func playerMute(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerNumberArgs.self)
    onMain(invoke) { NativePlayer.shared.setMuted(args.value != 0); return nil }
  }

  @objc public func playerAudioTrack(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerTrackArgs.self)
    onMain(invoke) { NativePlayer.shared.setAudioTrack(args.index); return nil }
  }

  @objc public func playerSubtitleTrack(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerTrackArgs.self)
    onMain(invoke) { NativePlayer.shared.setSubtitleTrack(args.index); return nil }
  }

  @objc public func playerSubDelay(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerNumberArgs.self)
    onMain(invoke) { NativePlayer.shared.setSubDelay(args.value); return nil }
  }

  @objc public func playerAudioDelay(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerNumberArgs.self)
    onMain(invoke) { NativePlayer.shared.setAudioDelay(args.value); return nil }
  }

  @objc public func playerAddSubtitle(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PlayerSubArgs.self)
    onMain(invoke) { NativePlayer.shared.addSubtitle(args) }
  }

  @objc public func playerState(_ invoke: Invoke) {
    onMain(invoke) { NativePlayer.shared.state() }
  }
}
