//! Native OCR acceptance adapter. Not shipped in the application bundle.
use navpdf_lib::ocr::{recognize_page, OcrOptions};

fn main() -> Result<(), String> {
    let path = std::env::args().nth(1).ok_or("Expected an image path")?;
    let bytes = std::fs::read(path).map_err(|_| "Cannot read test image")?;
    let result = recognize_page(
        &bytes,
        &OcrOptions {
            page_index: 0,
            language: Some("en-US".into()),
            fast_mode: Some(false),
        },
    )?;
    println!(
        "{}",
        serde_json::to_string(&result).map_err(|_| "Cannot encode OCR result")?
    );
    Ok(())
}
