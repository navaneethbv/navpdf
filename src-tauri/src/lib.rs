mod commands;
pub mod engine;
mod filesystem;
mod logging;
pub mod ocr;
mod security;
mod signatures;
use commands::*;
use std::{collections::HashMap, fs, sync::Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            fs::create_dir_all(&root)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
            }
            let local = fs::read(root.join("settings.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<LocalData>(&b).ok())
                .unwrap_or_default();
            app.manage(AppState {
                documents: Mutex::new(HashMap::new()),
                local: Mutex::new(local),
                root,
                dirty: Mutex::new(false),
                saving: Mutex::new(false),
                engine: commands::engine::EngineState::default(),
            });
            let file = SubmenuBuilder::new(app, "File")
                .text("open", "Open PDF...")
                .text("save", "Save")
                .text("save-as", "Save As...")
                .separator()
                .text("home", "Close document")
                .build()?;
            let edit = SubmenuBuilder::new(app, "Edit")
                .text("undo", "Undo")
                .text("redo", "Redo")
                .separator()
                // WebKit text fields only receive Cut and Paste through these responder items.
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let view = SubmenuBuilder::new(app, "View")
                .text("zoom-in", "Zoom In")
                .text("zoom-out", "Zoom Out")
                .text("fit-page", "Fit Page")
                .text("fit-width", "Fit Width")
                .separator()
                .text("find", "Search Document")
                .build()?;
            let annotate = SubmenuBuilder::new(app, "Annotate")
                .text("highlight", "Highlight")
                .text("select", "Select Text")
                .build()?;
            // The predefined macOS Quit item calls NSApplication.terminate directly,
            // bypassing the runtime's cancellable exit event.
            let quit = MenuItemBuilder::with_id("quit", "Quit NavPDF")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let settings = SubmenuBuilder::new(app, "NavPDF")
                .text("settings", "Settings...")
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit)
                .build()?;
            app.set_menu(
                MenuBuilder::new(app)
                    .items(&[&settings, &file, &edit, &view, &annotate])
                    .build()?,
            )?;
            let window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .on_navigation(|url| {
                        if cfg!(debug_assertions) {
                            url.scheme() == "http"
                                && url.host_str() == Some("localhost")
                                && url.port() == Some(1420)
                        } else {
                            url.scheme() == "tauri" && url.host_str() == Some("localhost")
                                || url.scheme() == "http"
                                    && url.host_str() == Some("tauri.localhost")
                        }
                    })
                    .build()?;
            {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Let the renderer check its current state even when the
                        // most recent dirty-state IPC has not reached Rust yet.
                        api.prevent_close();
                        let _ = app_handle.emit("close-requested", ());
                    }
                });
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                let _ = app.emit("close-requested", ());
            } else {
                emit_action(app, event.id().as_ref());
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            import_document,
            print_document,
            open_recent,
            read_range,
            close_document,
            save_document,
            commit_working_revision,
            get_revision,
            local_state,
            save_preferences,
            clear_recents,
            remember_page,
            write_recovery,
            open_recovery,
            discard_recovery,
            mark_dirty,
            close_window,
            load_signatures,
            save_signature,
            delete_signature,
            migrate_signatures,
            ocr_recognize_page,
            ocr_get_engine_info,
            commands::engine::engine_stage,
            commands::engine::engine_take,
            commands::engine::engine_discard,
            commands::engine::engine_cancel,
            commands::engine::engine_redact,
            commands::engine::engine_compress,
            commands::engine::engine_inspect_page,
            commands::engine::engine_edit,
            commands::engine::engine_save_protected,
            commands::engine::engine_unlock,
            commands::engine::engine_choose_certificate,
            commands::engine::engine_forget_certificate,
            commands::engine::engine_save_signed,
            commands::engine::engine_verify_signatures
        ])
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                let pending = state.dirty.lock().map(|v| *v).unwrap_or(true)
                    || state.saving.lock().map(|v| *v).unwrap_or(true);
                if pending {
                    api.prevent_exit();
                    let _ = app.emit("close-requested", ());
                }
            }
        }),
        Err(error) => {
            eprintln!("NavPDF could not initialize its desktop runtime: {error}");
            std::process::exit(1);
        }
    }
}
