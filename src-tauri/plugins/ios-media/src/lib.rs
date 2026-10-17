//! Native iOS media controls the WebView cannot reach on its own:
//! system output volume (HTMLMediaElement.volume is read-only on iOS) and
//! screen brightness. The app talks to it through [`IosMedia::run`].

use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ios_media);

/// Handle to the Swift plugin; `None` on every platform but iOS.
pub struct IosMedia<R: Runtime>(Option<PluginHandle<R>>);

impl<R: Runtime> IosMedia<R> {
    /// Calls a Swift method (`getVolume`, `setVolume`, `getBrightness`,
    /// `setBrightness`) with `{ "value": f64 }` and returns its JSON answer.
    pub fn run(&self, method: &str, value: f64) -> Result<serde_json::Value, String> {
        match &self.0 {
            Some(handle) => handle
                .run_mobile_plugin::<serde_json::Value>(
                    method,
                    serde_json::json!({ "value": value }),
                )
                .map_err(|e| e.to_string()),
            None => Ok(serde_json::Value::Null),
        }
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ios-media")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            let handle = Some(_api.register_ios_plugin(init_plugin_ios_media)?);
            #[cfg(not(target_os = "ios"))]
            let handle: Option<PluginHandle<R>> = None;
            app.manage(IosMedia(handle));
            Ok(())
        })
        .build()
}
