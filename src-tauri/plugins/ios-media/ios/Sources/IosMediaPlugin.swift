import AVFoundation
import MediaPlayer
import SwiftRs
import Tauri
import UIKit
import WebKit

class ValueArgs: Decodable {
  let value: Double
}

/// System volume and screen brightness for the player's gestures and slider.
///
/// iOS gives no public API to set the output volume. The standard approach used
/// by video players is a hidden MPVolumeView: moving its slider changes the
/// system volume, and while it is in the view hierarchy iOS also suppresses the
/// big system volume HUD, so the app's own indicator is the only one shown.
class IosMediaPlugin: Plugin {
  private var volumeView: MPVolumeView?

  public override func load(webview: WKWebView) {
    DispatchQueue.main.async {
      self.installVolumeView(in: webview.window ?? self.keyWindow())
    }
  }

  private func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    for scene in scenes {
      if let window = scene.windows.first(where: { $0.isKeyWindow }) {
        return window
      }
    }
    return scenes.first?.windows.first
  }

  private func installVolumeView(in window: UIWindow?) {
    if volumeView?.superview != nil { return }
    guard let window = window else { return }
    let view = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 160, height: 40))
    view.alpha = 0.0001
    view.isUserInteractionEnabled = false
    window.addSubview(view)
    volumeView = view
  }

  private func volumeSlider() -> UISlider? {
    installVolumeView(in: keyWindow())
    return volumeView?.subviews.compactMap { $0 as? UISlider }.first
  }

  @objc public func getVolume(_ invoke: Invoke) {
    invoke.resolve(["value": Double(AVAudioSession.sharedInstance().outputVolume)])
  }

  @objc public func setVolume(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ValueArgs.self)
    let value = Float(min(1, max(0, args.value)))
    DispatchQueue.main.async {
      if let slider = self.volumeSlider() {
        slider.setValue(value, animated: false)
        slider.sendActions(for: .valueChanged)
      }
      invoke.resolve(["value": Double(value)])
    }
  }

  private func currentScreen() -> UIScreen {
    return keyWindow()?.windowScene?.screen ?? UIScreen.main
  }

  @objc public func getBrightness(_ invoke: Invoke) {
    DispatchQueue.main.async {
      invoke.resolve(["value": Double(self.currentScreen().brightness)])
    }
  }

  @objc public func setBrightness(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ValueArgs.self)
    let value = CGFloat(min(1, max(0, args.value)))
    DispatchQueue.main.async {
      self.currentScreen().brightness = value
      invoke.resolve(["value": Double(value)])
    }
  }
}

@_cdecl("init_plugin_ios_media")
public func initPlugin() -> Plugin {
  return IosMediaPlugin()
}
