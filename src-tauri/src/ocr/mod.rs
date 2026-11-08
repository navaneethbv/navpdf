use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    pub confidence: f32,
    /// Normalized coordinates in [0.0, 1.0] range where (0,0) is bottom-left.
    /// [x, y, width, height]
    pub bbox: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    pub confidence: f32,
    pub bbox: [f32; 4],
    pub words: Vec<OcrWord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrPageResult {
    pub page_index: usize,
    pub language: String,
    pub lines: Vec<OcrLine>,
    pub full_text: String,
    pub mean_confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrEngineInfo {
    pub engine_name: String,
    pub is_offline: bool,
    pub supported_languages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrOptions {
    pub page_index: usize,
    pub language: Option<String>,
    pub fast_mode: Option<bool>,
}

pub mod tesseract;
#[cfg(target_os = "macos")]
mod vision;

/// Which engine recognises text: the system's (Apple Vision) or an installed Tesseract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Engine {
    System,
    Tesseract { program: String, language: String },
}

/// Recognises a page with the chosen engine.
pub fn recognize_with(
    engine: &Engine,
    image_bytes: &[u8],
    options: &OcrOptions,
) -> Result<OcrPageResult, String> {
    match engine {
        Engine::System => recognize_page(image_bytes, options),
        Engine::Tesseract { program, language } => {
            check_image(image_bytes)?;
            let program = tesseract::program(program)?;
            // A Tesseract language chosen for this run wins over the saved default.
            let language = options
                .language
                .as_deref()
                .filter(|chosen| tesseract::valid_language(chosen))
                .unwrap_or(language);
            tesseract::recognize(&program, image_bytes, language, options.page_index)
        }
    }
}

/// Describes the chosen engine and its languages.
pub fn engine_info(engine: &Engine) -> Result<OcrEngineInfo, String> {
    match engine {
        Engine::System => get_engine_info(),
        Engine::Tesseract { program, .. } => {
            let program = tesseract::program(program)?;
            Ok(OcrEngineInfo {
                engine_name: "Tesseract (installed on this computer)".into(),
                is_offline: true,
                supported_languages: tesseract::languages(&program)?,
            })
        }
    }
}

/// Recognition is unavailable on platforms without a real local engine.
pub fn recognize_page(image_bytes: &[u8], options: &OcrOptions) -> Result<OcrPageResult, String> {
    check_image(image_bytes)?;
    #[cfg(target_os = "macos")]
    {
        vision::recognize(image_bytes, options)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = options;
        Err("Local OCR is unavailable on this platform. Choose Tesseract in Settings.".into())
    }
}

/// Checks a page image is a PNG within the size limits before any engine decodes it.
fn check_image(image_bytes: &[u8]) -> Result<(), String> {
    if image_bytes.is_empty() || image_bytes.len() > 32 * 1024 * 1024 {
        return Err("OCR image must be between 1 byte and 32 MB.".into());
    }
    // The frontend renders PNG. Inspect dimensions before Vision can allocate decoded pixels.
    if image_bytes.len() < 33
        || &image_bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &image_bytes[12..16] != b"IHDR"
    {
        return Err("OCR requires a valid PNG page image.".into());
    }
    let width = u32::from_be_bytes(image_bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(image_bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 16_000_000
    {
        return Err("This page exceeds the OCR image size limit.".into());
    }
    Ok(())
}

pub fn get_engine_info() -> Result<OcrEngineInfo, String> {
    #[cfg(target_os = "macos")]
    {
        vision::info()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Local OCR is unavailable on this platform.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_corrupt_images_instead_of_fabricating_text() {
        let options = OcrOptions {
            page_index: 0,
            language: None,
            fast_mode: None,
        };
        assert!(recognize_page(&[], &options).is_err());
        assert!(recognize_page(b"\x89PNG\r\n\x1a\n", &options).is_err());
    }
}
