// Builds the Swift package in ./ios and links it when targeting iOS.
// The plugin defines no Rust commands of its own: the app calls into it through
// its own `ios_media` command, so there is nothing to generate permissions for.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .try_build()
        .unwrap();
}
