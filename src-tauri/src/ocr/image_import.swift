import Foundation
import ImageIO

private func frameInteger(_ value: Int) -> Data {
    var number = UInt32(value).bigEndian
    return withUnsafeBytes(of: &number) { Data($0) }
}

private func decodeImages(_ data: Data) throws -> Data {
    func fail(_ text: String) -> NSError { NSError(domain: "NavPDF.ImageImport", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let type = CGImageSourceGetType(source) as String?,
          ["public.tiff", "public.heic", "public.heif"].contains(type) else {
        throw fail("Select a valid HEIC, HEIF or TIFF image.")
    }
    let indices = type == "public.tiff" ? Array(0..<CGImageSourceGetCount(source)) : [CGImageSourceGetPrimaryImageIndex(source)]
    guard !indices.isEmpty && indices.count <= 100 else { throw fail("Import supports at most 100 TIFF pages.") }
    var pixels = 0
    var sizes: [Int] = []
    for index in indices {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 16384, height <= 16384,
              width * height <= 32_000_000 else { throw fail("An image exceeds the 32 megapixel import limit.") }
        pixels += width * height
        guard pixels <= 64_000_000 else { throw fail("The image collection exceeds 64 megapixels.") }
        sizes.append(max(width, height))
    }
    var result = frameInteger(indices.count)
    for (position, index) in indices.enumerated() {
        let png: Data = try autoreleasepool {
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, index, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: sizes[position],
                kCGImageSourceShouldCacheImmediately: true
            ] as CFDictionary) else { throw fail("An image page could not be decoded.") }
            let output = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(output, "public.png" as CFString, 1, nil) else { throw fail("PNG encoder unavailable.") }
            // Do not copy EXIF, location or source metadata into the imported image.
            CGImageDestinationAddImage(destination, image, nil)
            guard CGImageDestinationFinalize(destination), output.length <= 25 * 1024 * 1024 else { throw fail("A converted image exceeds 25 MB.") }
            return output as Data
        }
        guard result.count + png.count + 4 <= 100 * 1024 * 1024 else { throw fail("Converted images exceed 100 MB.") }
        result.append(frameInteger(png.count)); result.append(png)
    }
    return result
}

@_cdecl("navpdf_decode_images")
public func navpdfDecodeImages(_ bytes: UnsafePointer<UInt8>, _ count: Int, _ length: UnsafeMutablePointer<Int>) -> UnsafeMutablePointer<UInt8>? {
    let result: Data
    do { result = try decodeImages(Data(bytes: bytes, count: count)) }
    catch { result = frameInteger(0) + Data(error.localizedDescription.utf8) }
    length.pointee = result.count
    let output = UnsafeMutablePointer<UInt8>.allocate(capacity: result.count)
    result.copyBytes(to: output, count: result.count)
    return output
}

@_cdecl("navpdf_free_images")
public func navpdfFreeImages(_ bytes: UnsafeMutablePointer<UInt8>) { bytes.deallocate() }
