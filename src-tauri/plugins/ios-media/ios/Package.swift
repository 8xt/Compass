// swift-tools-version:5.3

import PackageDescription

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
    // VLC for iOS. Downloaded by CI (see .github/workflows/ios-build.yml), not committed.
    .binaryTarget(
      name: "MobileVLCKit",
      path: "Frameworks/MobileVLCKit.xcframework"),
    .target(
      name: "tauri-plugin-ios-media",
      dependencies: [
        .byName(name: "Tauri"),
        "MobileVLCKit",
      ],
      path: "Sources"),
  ]
)
