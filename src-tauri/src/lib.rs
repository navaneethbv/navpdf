mod commands;
pub mod engine;
mod filesystem;
mod image_import;
mod logging;
pub mod ocr;
mod security;
mod signatures;
use commands::*;
use std::{collections::HashMap, fs, sync::Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    DragDropEvent, Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .manage(commands::open_queue::PendingOpenRequests::default())
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
            let open = MenuItemBuilder::with_id("open", "Open PDF...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save = MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as = MenuItemBuilder::with_id("save-as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let print = MenuItemBuilder::with_id("print", "Print...")
                .accelerator("CmdOrCtrl+P")
                .build(app)?;
            let close = MenuItemBuilder::with_id("home", "Close document")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;
            let create = SubmenuBuilder::new(app, "Create")
                .text("create-pdf", "Blank PDF...")
                .text("import-pdf", "PDF from Images or Files...")
                .build()?;
            let export = SubmenuBuilder::new(app, "Export a PDF")
                .text("office-export", "Microsoft Word...")
                .text("office-pptx", "Microsoft PowerPoint...")
                .text("office-xlsx", "Microsoft Excel...")
                .text("office-rtf", "Rich Text...")
                .text("convert", "Images or Plain Text...")
                .build()?;
            let file = SubmenuBuilder::new(app, "File")
                .item(&open)
                .text("open-recent", "Open Recent Files...")
                .item(&create)
                .text("import-pdf", "Import...")
                .text("combine-pdf", "Combine Files...")
                .separator()
                .items(&[&save, &save_as])
                .item(&export)
                .text("compress", "Compress a PDF...")
                .text("protect", "Protect Using Password...")
                .separator()
                .item(&print)
                .text("find", "Find")
                .text("properties", "Document Properties...")
                .separator()
                .item(&close)
                .build()?;
            let undo = MenuItemBuilder::with_id("undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?;
            let redo = MenuItemBuilder::with_id("redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?;
            let edit = SubmenuBuilder::new(app, "Edit")
                .items(&[&undo, &redo])
                .separator()
                // WebKit text fields only receive Cut and Paste through these responder items.
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .text("edit-objects", "Edit PDF...")
                .text("tools:add-text", "Add Text...")
                .text("tools:add-image", "Add Image...")
                .separator()
                .text("organize", "Organize Pages...")
                .text("page-workspace", "Delete or Rotate Pages...")
                .separator()
                .text("tools:redact", "Redact a PDF...")
                .text("ocr", "Scan and OCR...")
                .text("forms", "Prepare Form...")
                .text("fill-sign", "Fill and Sign...")
                .build()?;
            let find = MenuItemBuilder::with_id("find", "Search Document")
                .accelerator("CmdOrCtrl+F")
                .build(app)?;
            let navigation = SubmenuBuilder::new(app, "Page Navigation")
                .text("first-page", "First Page")
                .text("previous-page", "Previous Page")
                .text("next-page", "Next Page")
                .text("last-page", "Last Page")
                .separator()
                .text("go-to-page", "Go to Page...")
                .text("previous-view", "Previous View")
                .text("next-view", "Next View")
                .build()?;
            let display = SubmenuBuilder::new(app, "Page Display")
                .text("layout-single", "Single Page")
                .text("layout-continuous", "Continuous")
                .text("layout-spread", "Two Pages")
                .separator()
                .text("auto-scroll", "Automatically Scroll")
                .build()?;
            let zoom = SubmenuBuilder::new(app, "Zoom")
                .text("zoom-in", "Zoom In")
                .text("zoom-out", "Zoom Out")
                .text("actual-size", "Actual Size")
                .text("fit-page", "Fit Page")
                .text("fit-width", "Fit Width")
                .build()?;
            let panels = SubmenuBuilder::new(app, "Show/Hide")
                .text("all-tools", "All Tools")
                .text("quick-tools", "Quick Tools")
                .text("panel-pages", "Page Thumbnails")
                .text("panel-bookmarks", "Bookmarks")
                .text("panel-comments", "Comments")
                .build()?;
            let read_aloud = SubmenuBuilder::new(app, "Read Out Loud")
                .text("read-page", "Read This Page Only")
                .text("read-to-end", "Read to End of Document")
                .text("read-pause", "Pause or Resume")
                .text("read-stop", "Stop")
                .build()?;
            let view = SubmenuBuilder::new(app, "View")
                .text("rotate-view", "Rotate View Clockwise")
                .item(&navigation)
                .item(&display)
                .item(&zoom)
                .separator()
                .text("read-mode", "Read Mode")
                .item(&read_aloud)
                .fullscreen()
                .separator()
                .item(&panels)
                .text("settings", "Display Theme...")
                .text("night-mode", "Night Mode")
                .item(&find)
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .fullscreen()
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
            let help = SubmenuBuilder::new(app, "Help")
                .text("tour", "Take a Tour")
                .text("tips", "Show a Tip")
                .build()?;
            app.set_menu(
                MenuBuilder::new(app)
                    .items(&[&settings, &file, &edit, &view, &window_menu, &help])
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
                    } else if let tauri::WindowEvent::DragDrop(DragDropEvent::Drop {
                        paths, ..
                    }) = event
                    {
                        commands::register_open_paths(&app_handle, paths.clone());
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
            open_document_from_token,
            pending_open_requests,
            dismiss_open_request,
            open_external_url,
            import_document,
            print_document,
            open_recent,
            read_range,
            close_document,
            save_document,
            commands::export::export_file,
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
            import_image_frames,
            commands::engine::engine_stage,
            commands::engine::engine_take,
            commands::engine::engine_discard,
            commands::engine::engine_cancel,
            commands::engine::engine_redact,
            commands::engine::engine_compress,
            commands::engine::engine_prune,
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
        Ok(app) => app.run(|app, event| match event {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .into_iter()
                    .map(|url| url.to_file_path())
                    .collect::<Result<Vec<_>, _>>();
                if let Ok(paths) = paths {
                    commands::register_open_paths(app, paths);
                }
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                let state = app.state::<AppState>();
                let pending = state.dirty.lock().map(|v| *v).unwrap_or(true)
                    || state.saving.lock().map(|v| *v).unwrap_or(true);
                if pending {
                    api.prevent_exit();
                    let _ = app.emit("close-requested", ());
                }
            }
            _ => {}
        }),
        Err(error) => {
            eprintln!("NavPDF could not initialize its desktop runtime: {error}");
            std::process::exit(1);
        }
    }
}
