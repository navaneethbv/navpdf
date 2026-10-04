// Synthetic local ImageIO interoperability acceptance. No personal files are read.
import Foundation
import ImageIO
import CoreGraphics

@main
struct ImageImportAcceptance {
    static func main() throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let context = CGContext(data: nil, width: 120, height: 80, bitsPerComponent: 8, bytesPerRow: 480, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 120, height: 80))
        context.setFillColor(CGColor(red: 0.1, green: 0.4, blue: 0.7, alpha: 1)); context.fill(CGRect(x: 12, y: 10, width: 96, height: 60))
        let image = context.makeImage()!
        for (ext, type, pages) in [("heic", "public.heic", 1), ("tiff", "public.tiff", 2)] {
            let url = directory.appendingPathComponent("import-fixture.\(ext)")
            guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type as CFString, pages, nil) else { fatalError("Encoder unavailable: \(type)") }
            for _ in 0..<pages { CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: 6] as CFDictionary) }
            guard CGImageDestinationFinalize(destination) else { fatalError("Encoding failed") }
            let input = try Data(contentsOf: url)
            var length = 0
            let pointer = input.withUnsafeBytes { navpdfDecodeImages($0.bindMemory(to: UInt8.self).baseAddress!, input.count, &length) }!
            let output = Data(bytes: pointer, count: length); navpdfFreeImages(pointer)
            func number(_ offset: Int) -> Int { output[offset..<offset+4].reduce(0) { ($0 << 8) | Int($1) } }
            guard number(0) == pages else { fatalError("Wrong page count: \(String(data: output.dropFirst(4), encoding: .utf8) ?? "invalid")") }
            var offset = 4
            for page in 0..<pages {
                let count = number(offset); offset += 4
                let png = output.subdata(in: offset..<offset+count); offset += count
                let source = CGImageSourceCreateWithData(png as CFData, nil)!
                let decoded = CGImageSourceCreateImageAtIndex(source, 0, nil)!
                guard decoded.width == 80 && decoded.height == 120 else { fatalError("Orientation was lost") }
                try png.write(to: directory.appendingPathComponent("\(ext)-decoded-\(page+1).png"))
            }
            guard offset == output.count else { fatalError("Extra frame bytes") }
            print("\(ext): \(pages) page(s), orientation retained, PNG independently decoded")
        }
    }
}
