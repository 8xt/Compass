import Foundation
import ObjectiveC
import Tauri
import UIKit
import WebKit

// Native video player for iOS (VLC). Plays everything WebKit's <video> cannot:
// MKV, x265/HEVC 10-bit, TrueHD / Atmos, DTS, AVI, embedded ASS/PGS subtitles.
//
// Isolation: the app does NOT link VLC. MobileVLCKit.framework is only embedded
// in the bundle (by CI, for the "Compass VLC" build) and loaded with dlopen the
// first time a video needs it, then driven through the Objective-C runtime.
// If VLC is missing or broken, the app still launches and every call here
// reports an error that the web side turns into a normal fallback.
//
// Layout matches the desktop's embedded mpv: the video view sits under a
// transparent WKWebView, so the app's own player controls draw on top.

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

final class NativePlayer: NSObject {
  static let shared = NativePlayer()

  private var vlcReady = false
  private var vlcError: String?
  private var player: NSObject?
  private var videoView: UIView?
  private var everPlayed = false

  // VLCMediaPlayerState (MobileVLCKit 3.x)
  private enum State: Int {
    case stopped = 0, opening, buffering, ended, error, playing, paused, esAdded
  }

  // MARK: loading VLC

  private func loadVLC() -> Bool {
    if vlcReady { return true }
    if vlcError != nil { return false }
    guard let frameworks = Bundle.main.privateFrameworksPath else {
      vlcError = "no Frameworks folder in the app"
      return false
    }
    let path = frameworks + "/MobileVLCKit.framework/MobileVLCKit"
    guard FileManager.default.fileExists(atPath: path) else {
      vlcError = "VLC is not bundled in this build"
      return false
    }
    if dlopen(path, RTLD_NOW | RTLD_LOCAL) == nil {
      vlcError = "VLC failed to load: " + String(cString: dlerror())
      return false
    }
    guard NSClassFromString("VLCMediaPlayer") != nil, NSClassFromString("VLCMedia") != nil else {
      vlcError = "VLC classes not found"
      return false
    }
    vlcReady = true
    return true
  }

  // MARK: helpers

  private func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    for scene in scenes {
      if let window = scene.windows.first(where: { $0.isKeyWindow }) { return window }
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

  /// Black video view right under the web view; the web view becomes see-through.
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

  // Key-value access that never throws: an unknown key would raise an
  // Objective-C exception (and abort the app), so check the accessor exists.
  private func get(_ object: NSObject?, _ key: String) -> Any? {
    guard let object = object else { return nil }
    let cap = key.prefix(1).uppercased() + key.dropFirst()
    guard object.responds(to: NSSelectorFromString(key)) || object.responds(to: NSSelectorFromString("is" + cap))
    else { return nil }
    return object.value(forKey: key)
  }

  private func set(_ object: NSObject?, _ key: String, _ value: Any?) {
    guard let object = object else { return }
    let cap = key.prefix(1).uppercased() + key.dropFirst()
    guard object.responds(to: NSSelectorFromString("set" + cap + ":")) else { return }
    object.setValue(value, forKey: key)
  }

  private func call(_ object: NSObject?, _ selector: String) {
    guard let object = object else { return }
    let sel = NSSelectorFromString(selector)
    if object.responds(to: sel) { _ = object.perform(sel) }
  }

  private func vlcTime(milliseconds: Int) -> NSObject? {
    guard let timeClass = NSClassFromString("VLCTime") as? NSObject.Type else { return nil }
    let sel = NSSelectorFromString("timeWithNumber:")
    guard (timeClass as AnyObject).responds(to: sel) else { return nil }
    return (timeClass as AnyObject).perform(sel, with: NSNumber(value: milliseconds))?
      .takeUnretainedValue() as? NSObject
  }

  private func milliseconds(of time: Any?) -> Int {
    guard let time = time as? NSObject else { return 0 }
    return (get(time, "intValue") as? NSNumber)?.intValue ?? 0
  }

  private func makePlayer() -> NSObject? {
    if let p = player { return p }
    guard let cls = NSClassFromString("VLCMediaPlayer") as? NSObject.Type else { return nil }
    let p = cls.init()
    player = p
    return p
  }

  // MARK: commands (main thread)

  func load(_ args: PlayerLoadArgs) -> [String: Any] {
    guard loadVLC() else { return ["ok": false, "error": vlcError ?? "VLC unavailable"] }
    guard ensureView() else { return ["ok": false, "error": "no web view to attach video to"] }
    guard let url = URL(string: args.url) else { return ["ok": false, "error": "bad url"] }
    guard let p = makePlayer(),
      let mediaClass = NSClassFromString("VLCMedia") as? NSObject.Type
    else { return ["ok": false, "error": "VLC player could not be created"] }

    call(p, "stop")
    let mediaSel = NSSelectorFromString("mediaWithURL:")
    guard let media = (mediaClass as AnyObject).perform(mediaSel, with: url)?
      .takeUnretainedValue() as? NSObject
    else { return ["ok": false, "error": "VLC media could not be created"] }
    let addOption = NSSelectorFromString("addOption:")
    var options = [":network-caching=4000", ":http-reconnect"]
    if let ua = args.userAgent, !ua.isEmpty { options.append(":http-user-agent=\(ua)") }
    if let ref = args.referrer, !ref.isEmpty { options.append(":http-referrer=\(ref)") }
    if let start = args.startSec, start > 1 { options.append(":start-time=\(start)") }
    for option in options where media.responds(to: addOption) {
      _ = media.perform(addOption, with: option)
    }

    everPlayed = false
    videoView?.isHidden = false
    set(p, "drawable", videoView)
    set(p, "media", media)
    call(p, "play")
    return ["ok": true]
  }

  func stop() {
    call(player, "stop")
    set(player, "media", nil)
    videoView?.isHidden = true
    everPlayed = false
  }

  func play() { call(player, "play") }
  func pause() { call(player, "pause") }

  func seek(_ sec: Double) {
    guard let p = player else { return }
    if let t = vlcTime(milliseconds: Int(max(0, sec) * 1000)) {
      set(p, "time", t)
    } else if let media = get(p, "media") as? NSObject {
      let length = Double(milliseconds(of: get(media, "length"))) / 1000
      if length > 0 { set(p, "position", NSNumber(value: Float(sec / length))) }
    }
  }

  func setRate(_ rate: Double) { set(player, "rate", NSNumber(value: Float(rate))) }

  func setMuted(_ muted: Bool) {
    set(get(player, "audio") as? NSObject, "muted", NSNumber(value: muted))
  }

  func setAudioTrack(_ index: Int) {
    set(player, "currentAudioTrackIndex", NSNumber(value: index))
  }

  func setSubtitleTrack(_ index: Int) {
    set(player, "currentVideoSubTitleIndex", NSNumber(value: index))
  }

  /// Seconds in; VLC takes microseconds.
  func setSubDelay(_ sec: Double) {
    set(player, "currentVideoSubTitleDelay", NSNumber(value: Int(sec * 1_000_000)))
  }

  func setAudioDelay(_ sec: Double) {
    set(player, "currentAudioPlaybackDelay", NSNumber(value: Int(sec * 1_000_000)))
  }

  func addSubtitle(_ args: PlayerSubArgs) -> Bool {
    guard let p = player, let url = URL(string: args.url) else { return false }
    let sel = NSSelectorFromString("addPlaybackSlave:type:enforce:")
    guard let method = class_getInstanceMethod(type(of: p), sel) else { return false }
    typealias AddSlave = @convention(c) (AnyObject, Selector, NSURL, UInt, Bool) -> Int32
    let fn = unsafeBitCast(method_getImplementation(method), to: AddSlave.self)
    return fn(p, sel, url as NSURL, 0 /* subtitle */, args.select ?? true) == 0
  }

  private func tracks(names: String, indexes: String, current: String) -> [[String: Any]] {
    guard let p = player else { return [] }
    let n = (get(p, names) as? [Any]) ?? []
    let ix = (get(p, indexes) as? [Any]) ?? []
    let cur = (get(p, current) as? NSNumber)?.intValue ?? -1
    var out: [[String: Any]] = []
    for i in 0..<min(n.count, ix.count) {
      let index = (ix[i] as? NSNumber)?.intValue ?? -1
      out.append(["index": index, "name": (n[i] as? String) ?? "Track \(i + 1)", "selected": index == cur])
    }
    return out
  }

  func state() -> [String: Any] {
    if let error = vlcError { return ["state": "error", "error": error] }
    guard let p = player else { return ["state": "idle"] }
    let raw = (get(p, "state") as? NSNumber)?.intValue ?? 0
    let st = State(rawValue: raw) ?? .opening
    let playing = (get(p, "playing") as? NSNumber)?.boolValue ?? false
    let time = Double(milliseconds(of: get(p, "time"))) / 1000
    let media = get(p, "media") as? NSObject
    let length = Double(milliseconds(of: get(media, "length"))) / 1000
    let size = (get(p, "videoSize") as? NSValue)?.cgSizeValue ?? .zero
    if playing || st == .playing { everPlayed = true }
    var state: String
    switch st {
    case .opening: state = "loading"
    case .buffering, .esAdded: state = playing ? "playing" : (everPlayed ? "paused" : "loading")
    case .playing: state = "playing"
    case .paused: state = "paused"
    case .ended: state = "ended"
    case .error: state = "error"
    case .stopped: state = everPlayed ? "ended" : "loading"
    }
    return [
      "state": state,
      "time": time,
      "length": length,
      "buffering": st == .buffering || st == .opening,
      "rate": (get(p, "rate") as? NSNumber)?.doubleValue ?? 1,
      "width": Double(size.width),
      "height": Double(size.height),
      "audio": tracks(names: "audioTrackNames", indexes: "audioTrackIndexes", current: "currentAudioTrackIndex"),
      "subs": tracks(names: "videoSubTitlesNames", indexes: "videoSubTitlesIndexes", current: "currentVideoSubTitleIndex"),
      "error": st == .error ? "VLC could not open this source." : "",
    ]
  }

  /// Whether this build bundles VLC (cheap check, does not load it).
  func available() -> Bool {
    guard let frameworks = Bundle.main.privateFrameworksPath else { return false }
    return FileManager.default.fileExists(atPath: frameworks + "/MobileVLCKit.framework/MobileVLCKit")
  }
}

// MARK: Tauri command glue

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

  @objc public func playerAvailable(_ invoke: Invoke) {
    onMain(invoke) { ["available": NativePlayer.shared.available()] }
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
