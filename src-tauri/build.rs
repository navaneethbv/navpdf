fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/ocr/vision_helper.swift");
        let output =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("vision_helper.o");
        let swiftc = find_swiftc();
        let status = std::process::Command::new(&swiftc)
            .args([
                "-emit-object",
                "-parse-as-library",
                "src/ocr/vision_helper.swift",
                "-o",
            ])
            .arg(&output)
            .status()
            .expect("Swift compiler is required for Apple Vision OCR");
        assert!(status.success(), "Swift Vision bridge compilation failed");
        cc::Build::new()
            .object(output)
            .compile("navpdf_vision_helper");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=Vision");
        for path in swift_runtime_search_paths(&swiftc) {
            println!("cargo:rustc-link-search=native={}", path.display());
        }
        for library in [
            "swiftAVFoundation",
            "swiftAccelerate",
            "swiftCore",
            "swiftCoreAudio",
            "swiftCoreFoundation",
            "swiftCoreImage",
            "swiftCoreMIDI",
            "swiftCoreMedia",
            "swiftDispatch",
            "swiftIOKit",
            "swiftMetal",
            "swiftObjectiveC",
            "swiftQuartzCore",
            "swiftUniformTypeIdentifiers",
            "swiftXPC",
            "swift_Builtin_float",
            "swiftos",
            "swiftsimd",
        ] {
            println!("cargo:rustc-link-lib=dylib={library}");
        }
    }
}

fn find_swiftc() -> std::path::PathBuf {
    if let Some(path) = std::env::var_os("SWIFTC") {
        return path.into();
    }

    std::path::PathBuf::from("swiftc")
}

fn swift_runtime_search_paths(swiftc: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Ok(output) = std::process::Command::new(swiftc)
        .arg("-print-target-info")
        .output()
    {
        let target_info = String::from_utf8_lossy(&output.stdout);
        for line in target_info.lines() {
            let trimmed = line.trim().trim_matches(',').trim_matches('"');
            if trimmed.ends_with("/usr/lib/swift/macosx") || trimmed == "/usr/lib/swift" {
                paths.push(trimmed.into());
            }
        }
    }

    if let Ok(output) = std::process::Command::new("xcode-select")
        .arg("-p")
        .output()
    {
        if output.status.success() {
            let developer = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            if !developer.is_empty() {
                paths.push(
                    std::path::PathBuf::from(developer)
                        .join("Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/lib/swift"),
                );
            }
        }
    }
    paths.push(std::path::PathBuf::from("/usr/lib/swift"));
    paths
}
