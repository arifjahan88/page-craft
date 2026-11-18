
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
// use tauri::Emitter;
use std::sync::Mutex;

// Holds the file path passed via CLI (double-click / file association)
struct InitialFile(Mutex<Option<String>>);

// Keeps the active PDFDocument retained while the asynchronous macOS print sheet is open
#[cfg(target_os = "macos")]
static ACTIVE_PRINT_DOC: Mutex<usize> = Mutex::new(0);

#[cfg(target_os = "macos")]
#[link(name = "objc", kind = "dylib")]
#[link(name = "Foundation", kind = "framework")]
#[link(name = "AppKit", kind = "framework")]
#[link(name = "PDFKit", kind = "framework")]
extern "C" {
    fn objc_getClass(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn sel_registerName(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn objc_msgSend();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(InitialFile(Mutex::new(
            // Capture CLI arg at startup, before any async work
            std::env::args()
                .nth(1)
                .filter(|p| p.to_lowercase().ends_with(".pdf"))
        )))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.center().unwrap();
            window.set_min_size(Some(tauri::Size::Physical(
                tauri::PhysicalSize { width: 800, height: 600 }
            ))).unwrap();

            if let Some(icon) = app.default_window_icon().cloned() {
                let _ = window.set_icon(icon);
            }

            #[cfg(target_os = "macos")]
            unsafe {
                use std::ffi::{c_char, c_void};
                let msg_send_ptr = objc_msgSend as *const ();
                let icon_bytes = include_bytes!("../icons/icon.icns");

                let ns_data_cls = objc_getClass(b"NSData\0".as_ptr() as *const c_char);
                let sel_data =
                    sel_registerName(b"dataWithBytes:length:\0".as_ptr() as *const c_char);
                let data_fn: unsafe extern "C" fn(
                    *mut c_void,
                    *mut c_void,
                    *const u8,
                    usize,
                ) -> *mut c_void = std::mem::transmute(msg_send_ptr);
                let ns_data =
                    data_fn(ns_data_cls, sel_data, icon_bytes.as_ptr(), icon_bytes.len());

                if !ns_data.is_null() {
                    let ns_image_cls = objc_getClass(b"NSImage\0".as_ptr() as *const c_char);
                    let sel_alloc = sel_registerName(b"alloc\0".as_ptr() as *const c_char);
                    let sel_init_data =
                        sel_registerName(b"initWithData:\0".as_ptr() as *const c_char);
                    let sel_autorelease =
                        sel_registerName(b"autorelease\0".as_ptr() as *const c_char);
                    let alloc_fn: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
                        std::mem::transmute(msg_send_ptr);
                    let init_fn: unsafe extern "C" fn(
                        *mut c_void,
                        *mut c_void,
                        *mut c_void,
                    ) -> *mut c_void = std::mem::transmute(msg_send_ptr);

                    let allocated_img = alloc_fn(ns_image_cls, sel_alloc);
                    if !allocated_img.is_null() {
                        let ns_image = init_fn(allocated_img, sel_init_data, ns_data);
                        if !ns_image.is_null() {
                            let _ = alloc_fn(ns_image, sel_autorelease);
                            let ns_app_cls =
                                objc_getClass(b"NSApplication\0".as_ptr() as *const c_char);
                            let sel_shared = sel_registerName(
                                b"sharedApplication\0".as_ptr() as *const c_char,
                            );
                            let ns_app = alloc_fn(ns_app_cls, sel_shared);
                            let sel_set_icon = sel_registerName(
                                b"setApplicationIconImage:\0".as_ptr() as *const c_char,
                            );
                            let set_icon_fn: unsafe extern "C" fn(
                                *mut c_void,
                                *mut c_void,
                                *mut c_void,
                            ) = std::mem::transmute(msg_send_ptr);
                            set_icon_fn(ns_app, sel_set_icon, ns_image);
                        }
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_pdf_file,
            get_initial_file,
            show_window,
            write_binary_file,
            print_pdf_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Called by frontend on mount to get the file path passed via double-click
#[tauri::command]
fn get_initial_file(state: tauri::State<InitialFile>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

/// Read a PDF file from disk and return its bytes as base64
#[tauri::command]
async fn read_pdf_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64_encode(&bytes))
}

#[tauri::command]
async fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main")
        .ok_or("window not found")?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Write binary data to disk (e.g. for saving extracted ZIP archives)
#[tauri::command]
async fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

/// Native print handler — opens the native print dialog directly inside the application window
#[tauri::command]
async fn print_pdf_file(
    app: tauri::AppHandle,
    path: Option<String>,
    data: Option<Vec<u8>>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let pdf_bytes = if let Some(p) = path.as_ref().filter(|s| !s.is_empty()) {
            std::fs::read(p).map_err(|e| format!("Failed to read PDF for printing: {}", e))?
        } else if let Some(bytes) = data {
            bytes
        } else {
            return Err("No file path or data provided for printing".into());
        };

        let app_handle = app.clone();
        app.run_on_main_thread(move || {
            unsafe {
                use std::ffi::{c_char, c_void};

                let msg_send_ptr = objc_msgSend as *const ();

                // 1. [NSData dataWithBytes:length:]
                let ns_data_cls = objc_getClass(b"NSData\0".as_ptr() as *const c_char);
                let sel_data_with_bytes =
                    sel_registerName(b"dataWithBytes:length:\0".as_ptr() as *const c_char);
                let data_with_bytes: unsafe extern "C" fn(
                    *mut c_void,
                    *mut c_void,
                    *const u8,
                    usize,
                ) -> *mut c_void = std::mem::transmute(msg_send_ptr);
                let ns_data = data_with_bytes(
                    ns_data_cls,
                    sel_data_with_bytes,
                    pdf_bytes.as_ptr(),
                    pdf_bytes.len(),
                );
                if ns_data.is_null() {
                    return;
                }

                // 2. [[PDFDocument alloc] initWithData:ns_data]
                let pdf_doc_cls = objc_getClass(b"PDFDocument\0".as_ptr() as *const c_char);
                let sel_alloc = sel_registerName(b"alloc\0".as_ptr() as *const c_char);
                let sel_init_with_data =
                    sel_registerName(b"initWithData:\0".as_ptr() as *const c_char);
                let sel_release = sel_registerName(b"release\0".as_ptr() as *const c_char);

                let msg_alloc: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
                    std::mem::transmute(msg_send_ptr);
                let msg_release: unsafe extern "C" fn(*mut c_void, *mut c_void) =
                    std::mem::transmute(msg_send_ptr);
                let msg_init_data: unsafe extern "C" fn(
                    *mut c_void,
                    *mut c_void,
                    *mut c_void,
                ) -> *mut c_void = std::mem::transmute(msg_send_ptr);

                let allocated_doc = msg_alloc(pdf_doc_cls, sel_alloc);
                if allocated_doc.is_null() {
                    return;
                }
                let pdf_doc = msg_init_data(allocated_doc, sel_init_with_data, ns_data);
                if pdf_doc.is_null() {
                    return;
                }

                // Keep pdf_doc retained while the modal print sheet is active
                if let Ok(mut guard) = ACTIVE_PRINT_DOC.lock() {
                    if *guard != 0 {
                        msg_release(*guard as *mut c_void, sel_release);
                    }
                    *guard = pdf_doc as usize;
                }

                // 3. [NSPrintInfo sharedPrintInfo]
                let print_info_cls = objc_getClass(b"NSPrintInfo\0".as_ptr() as *const c_char);
                let sel_shared_info =
                    sel_registerName(b"sharedPrintInfo\0".as_ptr() as *const c_char);
                let print_info = msg_alloc(print_info_cls, sel_shared_info);

                // 4. [pdf_doc printOperationForPrintInfo:scalingMode:autoRotate:]
                // kPDFPrintPageScaleDownToFit = 2
                let sel_print_op = sel_registerName(
                    b"printOperationForPrintInfo:scalingMode:autoRotate:\0".as_ptr()
                        as *const c_char,
                );
                let msg_print_op: unsafe extern "C" fn(
                    *mut c_void,
                    *mut c_void,
                    *mut c_void,
                    isize,
                    bool,
                ) -> *mut c_void = std::mem::transmute(msg_send_ptr);
                let print_op = msg_print_op(pdf_doc, sel_print_op, print_info, 2, true);
                if print_op.is_null() {
                    return;
                }

                // 5. Configure print panel visibility
                let sel_shows_print =
                    sel_registerName(b"setShowsPrintPanel:\0".as_ptr() as *const c_char);
                let sel_shows_progress =
                    sel_registerName(b"setShowsProgressPanel:\0".as_ptr() as *const c_char);
                let msg_set_bool: unsafe extern "C" fn(*mut c_void, *mut c_void, bool) =
                    std::mem::transmute(msg_send_ptr);
                msg_set_bool(print_op, sel_shows_print, true);
                msg_set_bool(print_op, sel_shows_progress, true);

                // 6. Attach print dialog sheet directly to the main application window
                let ns_window = app_handle
                    .get_webview_window("main")
                    .and_then(|w| w.ns_window().ok())
                    .unwrap_or(std::ptr::null_mut());

                if !ns_window.is_null() {
                    let sel_run_modal = sel_registerName(
                        b"runOperationModalForWindow:delegate:didRunSelector:contextInfo:\0"
                            .as_ptr() as *const c_char,
                    );
                    let msg_run_modal: unsafe extern "C" fn(
                        *mut c_void,
                        *mut c_void,
                        *mut c_void,
                        *mut c_void,
                        *mut c_void,
                        *mut c_void,
                    ) = std::mem::transmute(msg_send_ptr);
                    msg_run_modal(
                        print_op,
                        sel_run_modal,
                        ns_window,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                    );
                } else {
                    let sel_run = sel_registerName(b"runOperation\0".as_ptr() as *const c_char);
                    let msg_run: unsafe extern "C" fn(*mut c_void, *mut c_void) -> bool =
                        std::mem::transmute(msg_send_ptr);
                    let _ = msg_run(print_op, sel_run);
                }
            }
        })
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let target_path = if let Some(p) = path.filter(|s| !s.is_empty()) {
            p
        } else if let Some(bytes) = data {
            let temp_path = std::env::temp_dir().join("pdf_reader_print.pdf");
            std::fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;
            temp_path.to_string_lossy().to_string()
        } else {
            return Err("No file path or data provided for printing".into());
        };

        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start", "", "/P", &target_path])
                .spawn();
            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("lpr").arg(&target_path).spawn();
            Ok(())
        }
    }
}

fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        let _ = write!(result, "{}", CHARS[b0 >> 2] as char);
        let _ = write!(result, "{}", CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            let _ = write!(result, "{}", CHARS[((b1 & 15) << 2) | (b2 >> 6)] as char);
        } else { result.push('='); }
        if chunk.len() > 2 {
            let _ = write!(result, "{}", CHARS[b2 & 63] as char);
        } else { result.push('='); }
    }
    result
}