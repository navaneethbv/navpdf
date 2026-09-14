use super::{OcrEngineInfo, OcrLine, OcrOptions, OcrPageResult, OcrWord};
use objc2::{rc::autoreleasepool, AllocAnyThread};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};

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
    autoreleasepool(|_| {
        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(if options.fast_mode.unwrap_or(false) {
            VNRequestTextRecognitionLevel::Fast
        } else {
            VNRequestTextRecognitionLevel::Accurate
        });
        let language = options.language.as_deref().unwrap_or("en-US");
        let supported = unsafe { request.supportedRecognitionLanguagesAndReturnError() }
            .map_err(|_| "Unable to query installed OCR languages.")?;
        if !supported.iter().any(|s| s.to_string() == language) {
            return Err("The selected OCR language is unavailable on this Mac.".into());
        }
        request.setRecognitionLanguages(&NSArray::from_retained_slice(&[NSString::from_str(
            language,
        )]));
        let handler = VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(),
            &NSData::with_bytes(image),
            &NSDictionary::new(),
        );
        let requests = NSArray::<VNRequest>::from_slice(&[&request]);
        handler
            .performRequests_error(&requests)
            .map_err(|_| "Apple Vision could not recognize this image.")?;
        let observations = request
            .results()
            .ok_or("OCR returned no result collection.")?;
        let mut lines = Vec::new();
        for observation in observations.iter() {
            let candidates = observation.topCandidates(1);
            let Some(candidate) = candidates.firstObject() else {
                continue;
            };
            let text = candidate.string().to_string();
            let rect = unsafe { observation.boundingBox() };
            let bbox = [
                rect.origin.x as f32,
                rect.origin.y as f32,
                rect.size.width as f32,
                rect.size.height as f32,
            ];
            let confidence = candidate.confidence();
            // Preserve Vision's measured line rectangle instead of inventing word positions.
            let words = vec![OcrWord {
                text: text.clone(),
                confidence,
                bbox,
            }];
            lines.push(OcrLine {
                text,
                confidence,
                bbox,
                words,
            });
        }
        let full_text = lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let mean_confidence = if lines.is_empty() {
            0.0
        } else {
            lines.iter().map(|l| l.confidence).sum::<f32>() / lines.len() as f32
        };
        Ok(OcrPageResult {
            page_index: options.page_index,
            language: language.into(),
            lines,
            full_text,
            mean_confidence,
        })
    })
}
