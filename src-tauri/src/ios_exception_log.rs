//! iOS: record Objective-C exceptions before they reach Rust.
//!
//! Tauri runs the whole iOS app inside Rust's `start_app`. An Objective-C
//! exception thrown anywhere (UIKit, WebKit, a Swift plugin, VLC) unwinds into
//! Rust, which cannot catch foreign exceptions and aborts, leaving a crash log
//! without the exception's message. The runtime's exception preprocessor sees
//! every exception at throw time, so append its description and call stack to
//! Documents/compass-exceptions.log, visible in the Files app
//! (On My iPad > Compass) because the app enables file sharing.

use std::ffi::{c_char, c_void, CStr};
use std::io::Write;

type Id = *mut c_void;
type Sel = *mut c_void;
type Preprocessor = extern "C" fn(Id) -> Id;

#[link(name = "objc")]
extern "C" {
    fn objc_setExceptionPreprocessor(f: Preprocessor) -> Option<Preprocessor>;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
}

static mut PREVIOUS: Option<Preprocessor> = None;

unsafe fn send_id(obj: Id, sel: &CStr) -> Id {
    let f: extern "C" fn(Id, Sel) -> Id = std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    f(obj, sel_registerName(sel.as_ptr()))
}

unsafe fn ns_string(obj: Id) -> String {
    if obj.is_null() {
        return String::new();
    }
    let f: extern "C" fn(Id, Sel) -> *const c_char =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    let p = f(obj, sel_registerName(c"UTF8String".as_ptr()));
    if p.is_null() {
        String::new()
    } else {
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

extern "C" fn preprocess(exception: Id) -> Id {
    unsafe {
        let name = ns_string(send_id(exception, c"name"));
        let reason = ns_string(send_id(exception, c"reason"));
        let stack = ns_string(send_id(send_id(exception, c"callStackSymbols"), c"description"));
        if let Ok(home) = std::env::var("HOME") {
            let dir = std::path::Path::new(&home).join("Documents");
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join("compass-exceptions.log");
            // Keep the file small: start over once it passes 256 KB.
            if std::fs::metadata(&path).map(|m| m.len() > 256 * 1024).unwrap_or(false) {
                let _ = std::fs::remove_file(&path);
            }
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                let secs = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let _ = writeln!(f, "==== {secs} {name}\n{reason}\n{stack}\n");
            }
        }
        match PREVIOUS {
            Some(prev) => prev(exception),
            None => exception,
        }
    }
}

pub fn install() {
    unsafe {
        PREVIOUS = objc_setExceptionPreprocessor(preprocess);
    }
}
