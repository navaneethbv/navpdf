import Foundation
import Vision

private func jsonResult(_ value: Any) -> UnsafeMutablePointer<CChar>? {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else {
        return nil
    }
    let result = UnsafeMutablePointer<CChar>.allocate(capacity: data.count + 1)
    data.withUnsafeBytes { bytes in
        result.initialize(from: bytes.bindMemory(to: CChar.self).baseAddress!, count: data.count)
    }
    result[data.count] = 0
    return result
}

@_cdecl("navpdf_vision_recognize")
public func navpdfVisionRecognize(
    _ image: UnsafePointer<UInt8>,
    _ imageLength: Int,
    _ language: UnsafePointer<CChar>,
    _ fastMode: Int32
) -> UnsafeMutablePointer<CChar>? {
    let data = Data(bytes: image, count: imageLength)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = fastMode == 0 ? .accurate : .fast
    request.recognitionLanguages = [String(cString: language)]

    do {
        try VNImageRequestHandler(data: data).perform([request])
    } catch {
        return jsonResult(["error": error.localizedDescription])
    }

    let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }
        let box = observation.boundingBox
        return [
            "text": candidate.string,
            "confidence": candidate.confidence,
            "bbox": [box.origin.x, box.origin.y, box.size.width, box.size.height],
        ]
    }
    return jsonResult(["lines": lines])
}

@_cdecl("navpdf_vision_free")
public func navpdfVisionFree(_ result: UnsafeMutablePointer<CChar>?) {
    result?.deallocate()
}
