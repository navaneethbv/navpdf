use std::ffi::{CStr, CString};

use super::{OcrEngineInfo, OcrLine, OcrOptions, OcrPageResult, OcrWord};
use objc2::rc::autoreleasepool;
use objc2_vision::VNRecognizeTextRequest;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct VisionResponse {
    lines: Option<Vec<VisionLine>>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VisionLine {
    text: String,
    confidence: f32,
    bbox: [f32; 4],
}

unsafe extern "C" {
    fn navpdf_vision_recognize(
        image: *const u8,
        image_length: usize,
        language: *const std::ffi::c_char,
        fast_mode: i32,
    ) -> *mut std::ffi::c_char;
    fn navpdf_vision_free(result: *mut std::ffi::c_char);
}

pub fn info() -> Result<OcrEngineInfo, String> {
    autoreleasepool(|_| {
        let request = VNRecognizeTextRequest::new();
        // The request is local to this thread and initialized before querying Vision.
        let languages = unsafe { request.supportedRecognitionLanguagesAndReturnError() }
            .map_err(|_| "Unable to query installed OCR languages.")?;
        Ok(OcrEngineInfo {
            engine_name: "Apple Vision".into(),
            is_offline: true,
            supported_languages: languages.iter().map(|s| s.to_string()).collect(),
        })
    })
}

pub fn recognize(image: &[u8], options: &OcrOptions) -> Result<OcrPageResult, String> {
    let language = options.language.as_deref().unwrap_or("en-US");
    let supported =
        unsafe { VNRecognizeTextRequest::new().supportedRecognitionLanguagesAndReturnError() }
            .map_err(|_| "Unable to query installed OCR languages.")?;
    if !supported.iter().any(|s| s.to_string() == language) {
        return Err("The selected OCR language is unavailable on this Mac.".into());
    }

    let language_c = CString::new(language)
        .map_err(|_| "The selected OCR language contains an invalid character.")?;
    let result = unsafe {
        navpdf_vision_recognize(
            image.as_ptr(),
            image.len(),
            language_c.as_ptr(),
            i32::from(options.fast_mode.unwrap_or(false)),
        )
    };
    if result.is_null() {
        return Err("Apple Vision did not return a result.".into());
    }
    let json = unsafe {
        let bytes = CStr::from_ptr(result).to_bytes();
        let json = std::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|_| "Apple Vision returned invalid result data.");
        navpdf_vision_free(result);
        json?
    };
    let response: VisionResponse =
        serde_json::from_str(&json).map_err(|_| "Apple Vision returned malformed result data.")?;
    if let Some(error) = response.error {
        return Err(format!(
            "Apple Vision could not recognize this image: {error}"
        ));
    }
    let lines = response
        .lines
        .ok_or("Apple Vision returned no result collection.")?
        .into_iter()
        .map(|line| OcrLine {
            text: line.text.clone(),
            confidence: line.confidence,
            bbox: line.bbox,
            // Vision returns line-level observations, so keep word geometry conservative.
            words: vec![OcrWord {
                text: line.text,
                confidence: line.confidence,
                bbox: line.bbox,
            }],
        })
        .collect::<Vec<_>>();
    let full_text = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let mean_confidence = if lines.is_empty() {
        0.0
    } else {
        lines.iter().map(|line| line.confidence).sum::<f32>() / lines.len() as f32
    };
    Ok(OcrPageResult {
        page_index: options.page_index,
        language: language.into(),
        lines,
        full_text,
        mean_confidence,
    })
}
