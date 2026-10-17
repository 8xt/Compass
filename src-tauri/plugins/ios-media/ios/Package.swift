// swift-tools-version:5.3

import Foundation
import PackageDescription

// MobileVLCKit (VLC for iOS) is downloaded by CI into Frameworks/ (not committed).
// Tauri compiles this package with `swift build` for the device, which cannot
// consume .xcframework binary targets, so point the compiler at the device
// slice's MobileVLCKit.framework, copied to Frameworks/device by CI.
let packageDir = URL(fileURLWithPath: #file).deletingLastPathComponent().path
let vlcFrameworks = packageDir + "/Frameworks/device"

let package = Package(
  name: "tauri-plugin-ios-media",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-ios-media",
      type: .static,
      targets: ["tauri-plugin-ios-media"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-ios-media",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources",
      swiftSettings: [
        .unsafeFlags(["-F", vlcFrameworks])
      ])
  ]
)
