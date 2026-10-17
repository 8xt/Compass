// Builds the Swift package in ./ios and links it when targeting iOS.
// The plugin defines no Rust commands of its own: the app calls into it through
// its own `ios_media` command, so there is nothing to generate permissions for.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .try_build()
        .unwrap();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        link_vlc();
    }
}

/// The Swift code uses MobileVLCKit (a static framework CI downloads into
/// ios/Frameworks). The app crate is also built as a cdylib, and that link
/// needs every symbol, so link VLC and its system dependencies here too.
fn link_vlc() {
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    // CI copies the device slice of MobileVLCKit.xcframework here.
    let slice = manifest.join("ios/Frameworks/device");
    println!("cargo:rerun-if-changed={}", slice.display());
    if !slice.join("MobileVLCKit.framework").exists() {
        panic!("{}/MobileVLCKit.framework missing: CI downloads it before the iOS build", slice.display());
    }
    println!("cargo:rustc-link-search=framework={}", slice.display());
    println!("cargo:rustc-link-lib=framework=MobileVLCKit");
    for lib in ["c++", "xml2", "z", "bz2", "iconv"] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
    for fw in [
        "AVFoundation",
        "AudioToolbox",
        "CoreMedia",
        "CoreVideo",
        "VideoToolbox",
        "CoreText",
        "CoreGraphics",
        "QuartzCore",
        "Security",
        "CFNetwork",
        "OpenGLES",
        "UIKit",
        "MediaPlayer",
    ] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
}
