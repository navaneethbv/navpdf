fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/ocr/vision_helper.swift");
        let output =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("vision_helper.o");
        let status = std::process::Command::new("swiftc")
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
        println!("cargo:rustc-link-search=/usr/lib/swift");
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
