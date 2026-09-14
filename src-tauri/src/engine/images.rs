//! Decoding, pixel redaction, resampling and re-encoding of 8-bit raster image XObjects.

use super::content::deref;
use super::geometry::{number, Matrix, Rect};
use jpeg_encoder::{ColorType, Encoder};
use lopdf::{Dictionary, Document, Object, Stream};
use zune_jpeg::zune_core::bytestream::ZCursor;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;
use zune_jpeg::JpegDecoder;

/// Images larger than this are never decoded, bounding memory for pixel work.
pub const MAX_PIXELS: usize = 64_000_000;
const MAX_JPEG_DIMENSION: usize = u16::MAX as usize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Raw,
    Flate,
    Jpeg,
}

/// Interleaved 8-bit samples with the first row at the top of the image.
#[derive(Clone, Debug)]
pub struct Raster {
    pub width: usize,
    pub height: usize,
    pub components: usize,
    pub pixels: Vec<u8>,
    pub source: Source,
}

/// Pixel rectangle `(x0, y0, x1, y1)` with exclusive upper bounds, rows counted from the top.
pub type PixelRegion = (usize, usize, usize, usize);

/// Decodes an image XObject, or explains why its samples cannot be processed safely.
pub fn decode(doc: &Document, stream: &Stream) -> Result<Raster, &'static str> {
    let dict = &stream.dict;
    let value = |key: &[u8]| dict.get(key).ok().map(|object| deref(doc, object));
    if value(b"ImageMask")
        .and_then(|o| o.as_bool().ok())
        .unwrap_or(false)
    {
        return Err("stencil masks are not decoded");
    }
    if value(b"Mask").is_some_and(|mask| mask.as_stream().is_ok()) {
        return Err("explicit image masks are not decoded");
    }
    let dimension = |key: &[u8]| {
        value(key)
            .and_then(|o| o.as_i64().ok())
            .and_then(|v| usize::try_from(v).ok())
            .filter(|v| *v > 0)
    };
    let (Some(width), Some(height)) = (dimension(b"Width"), dimension(b"Height")) else {
        return Err("image dimensions are invalid");
    };
    if width
        .checked_mul(height)
        .is_none_or(|pixels| pixels > MAX_PIXELS)
    {
        return Err("the image is too large to decode");
    }
    let components =
        color_components(doc, value(b"ColorSpace")).ok_or("the color space is unsupported")?;
    // Only the default [0 1] mapping per component keeps samples meaningful after re-encoding.
    let default_decode = value(b"Decode").is_none_or(|decode| {
        decode.as_array().is_ok_and(|values| {
            values.len() == components * 2
                && values
                    .chunks_exact(2)
                    .all(|pair| number(&pair[0]) == Some(0.0) && number(&pair[1]) == Some(1.0))
        })
    });
    if !default_decode {
        return Err("custom decode arrays are not decoded");
    }
    let expected = width * height * components;
    match filter_names(doc, value(b"Filter")).as_slice() {
        [] | [b"FlateDecode"] => {
            if value(b"BitsPerComponent").and_then(|o| o.as_i64().ok()) != Some(8) {
                return Err("only 8-bit samples are decoded");
            }
            let mut pixels = super::stream_bytes(stream)
                .map_err(|_| "image samples could not be decompressed")?;
            if pixels.len() < expected {
                return Err("image samples are truncated");
            }
            pixels.truncate(expected);
            let source = if dict.has(b"Filter") {
                Source::Flate
            } else {
                Source::Raw
            };
            Ok(Raster {
                width,
                height,
                components,
                pixels,
                source,
            })
        }
        [b"DCTDecode"] => {
            if components == 4 {
                return Err("CMYK JPEG images are not decoded");
            }
            let colorspace = if components == 1 {
                ColorSpace::Luma
            } else {
                ColorSpace::RGB
            };
            let options = DecoderOptions::default()
                .jpeg_set_out_colorspace(colorspace)
                .set_max_width(MAX_JPEG_DIMENSION)
                .set_max_height(MAX_JPEG_DIMENSION);
            let mut decoder =
                JpegDecoder::new_with_options(ZCursor::new(stream.content.as_slice()), options);
            let pixels = decoder
                .decode()
                .map_err(|_| "JPEG data could not be decoded")?;
            if pixels.len() != expected {
                return Err("JPEG dimensions do not match the image dictionary");
            }
            Ok(Raster {
                width,
                height,
                components,
                pixels,
                source: Source::Jpeg,
            })
        }
        _ => Err("the image filter is unsupported"),
    }
}

fn filter_names<'a>(doc: &'a Document, filter: Option<&'a Object>) -> Vec<&'a [u8]> {
    match filter {
        Some(Object::Name(name)) => vec![name.as_slice()],
        Some(Object::Array(names)) => names
            .iter()
            .filter_map(|name| deref(doc, name).as_name().ok())
            .collect(),
        _ => Vec::new(),
    }
}

fn color_components(doc: &Document, space: Option<&Object>) -> Option<usize> {
    match space? {
        Object::Name(name) => match name.as_slice() {
            b"DeviceGray" | b"CalGray" => Some(1),
            b"DeviceRGB" | b"CalRGB" => Some(3),
            b"DeviceCMYK" => Some(4),
            _ => None,
        },
        Object::Array(parts) => match parts.first().and_then(|o| o.as_name().ok()) {
            Some(b"CalGray") => Some(1),
            Some(b"CalRGB") | Some(b"Lab") => Some(3),
            Some(b"ICCBased") => parts
                .get(1)
                .map(|stream| deref(doc, stream))
                .and_then(|stream| stream.as_stream().ok())
                .and_then(|stream| stream.dict.get(b"N").ok())
                .and_then(|n| n.as_i64().ok())
                .and_then(|n| usize::try_from(n).ok())
                .filter(|n| matches!(n, 1 | 3 | 4)),
            _ => None,
        },
        _ => None,
    }
}

impl Raster {
    /// Sets every sample in the region to `value` for each component.
    pub fn fill(&mut self, region: PixelRegion, value: &[u8]) {
        let (x0, y0, x1, y1) = region;
        if value.len() != self.components {
            return;
        }
        for row in y0.min(self.height)..y1.min(self.height) {
            for col in x0.min(self.width)..x1.min(self.width) {
                let offset = (row * self.width + col) * self.components;
                self.pixels[offset..offset + self.components].copy_from_slice(value);
            }
        }
    }

    /// Opaque black in this raster's component layout.
    pub fn black(&self) -> Vec<u8> {
        match self.components {
            4 => vec![0, 0, 0, 255],
            n => vec![0; n],
        }
    }

    /// True when every sample in the region is black within `tolerance` (for lossy data).
    pub fn is_black(&self, region: PixelRegion, tolerance: u8) -> bool {
        let (x0, y0, x1, y1) = region;
        (y0.min(self.height)..y1.min(self.height)).all(|row| {
            (x0.min(self.width)..x1.min(self.width)).all(|col| {
                let offset = (row * self.width + col) * self.components;
                let sample = &self.pixels[offset..offset + self.components];
                match self.components {
                    4 => {
                        sample[..3].iter().all(|v| *v <= tolerance) && sample[3] >= 255 - tolerance
                    }
                    _ => sample.iter().all(|v| *v <= tolerance),
                }
            })
        })
    }

    /// Area-averaging resample, used for downsampling.
    pub fn resample(&self, width: usize, height: usize) -> Raster {
        let (width, height) = (width.max(1), height.max(1));
        let channels = self.components;
        let mut pixels = vec![0_u8; width * height * channels];
        for y in 0..height {
            let sy0 = y * self.height / height;
            let sy1 = ((y + 1) * self.height / height).clamp(sy0 + 1, self.height);
            for x in 0..width {
                let sx0 = x * self.width / width;
                let sx1 = ((x + 1) * self.width / width).clamp(sx0 + 1, self.width);
                let count = ((sy1 - sy0) * (sx1 - sx0)) as u64;
                for channel in 0..channels {
                    let mut sum = 0_u64;
                    for sy in sy0..sy1 {
                        let row = sy * self.width;
                        for sx in sx0..sx1 {
                            sum += u64::from(self.pixels[(row + sx) * channels + channel]);
                        }
                    }
                    pixels[(y * width + x) * channels + channel] =
                        ((sum + count / 2) / count) as u8;
                }
            }
        }
        Raster {
            width,
            height,
            components: channels,
            pixels,
            source: self.source,
        }
    }
}

/// Pixel bounds of a user-space region on an image placed with `ctm`, padded by one
/// sample so rounding can never leave an edge row or column of the region untouched.
pub fn pixel_region(
    ctm: &Matrix,
    region: &Rect,
    width: usize,
    height: usize,
) -> Option<PixelRegion> {
    let bounds = ctm.invert()?.transform_rect(region);
    let (u0, u1) = (bounds.x0.max(0.0), bounds.x1.min(1.0));
    let (v0, v1) = (bounds.y0.max(0.0), bounds.y1.min(1.0));
    if u0 >= u1 || v0 >= v1 {
        return None;
    }
    let (w, h) = (width as f64, height as f64);
    let x0 = ((u0 * w).floor() as usize).saturating_sub(1);
    let y0 = (((1.0 - v1) * h).floor() as usize).saturating_sub(1);
    let x1 = ((u1 * w).ceil() as usize + 1).min(width);
    let y1 = (((1.0 - v0) * h).ceil() as usize + 1).min(height);
    Some((x0, y0, x1, y1))
}

fn image_dictionary(template: &Dictionary, raster: &Raster) -> Dictionary {
    let mut dict = template.clone();
    for key in [b"Filter".as_slice(), b"DecodeParms", b"Length", b"DL"] {
        dict.remove(key);
    }
    dict.set("Width", raster.width as i64);
    dict.set("Height", raster.height as i64);
    dict.set("BitsPerComponent", 8);
    dict
}

/// Lossless Flate image stream that keeps the template's color space and other entries.
pub fn encode_flate(raster: &Raster, template: &Dictionary) -> Stream {
    let mut stream = Stream::new(image_dictionary(template, raster), raster.pixels.clone());
    let _ = stream.compress();
    stream
}

/// Baseline JPEG image stream for grayscale or three-component images.
pub fn encode_jpeg(
    raster: &Raster,
    template: &Dictionary,
    quality: u8,
) -> Result<Stream, &'static str> {
    let color = match raster.components {
        1 => ColorType::Luma,
        3 => ColorType::Rgb,
        _ => return Err("only grayscale and RGB images are JPEG encoded"),
    };
    let (Ok(width), Ok(height)) = (u16::try_from(raster.width), u16::try_from(raster.height))
    else {
        return Err("the image is too large for JPEG");
    };
    let mut data = Vec::new();
    Encoder::new(&mut data, quality.clamp(1, 100))
        .encode(&raster.pixels, width, height, color)
        .map_err(|_| "the image could not be JPEG encoded")?;
    let mut dict = image_dictionary(template, raster);
    dict.set("Filter", "DCTDecode");
    Ok(Stream::new(dict, data).with_compression(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn gray(width: usize, height: usize) -> Raster {
        Raster {
            width,
            height,
            components: 1,
            pixels: (0..width * height).map(|i| 100 + (i % 50) as u8).collect(),
            source: Source::Raw,
        }
    }

    #[test]
    fn region_maps_through_the_placement_matrix_from_the_top_row() {
        let ctm = Matrix::new(100.0, 0.0, 0.0, 100.0, 0.0, 0.0);
        // The upper-left quadrant of a 10x10 image placed over (0,0)-(100,100).
        let region = pixel_region(&ctm, &Rect::new(0.0, 50.0, 50.0, 100.0), 10, 10).unwrap();
        assert_eq!(region, (0, 0, 6, 6));
        assert!(pixel_region(&ctm, &Rect::new(200.0, 200.0, 300.0, 300.0), 10, 10).is_none());
    }

    #[test]
    fn flate_and_jpeg_round_trips_preserve_redacted_pixels() {
        let doc = Document::with_version("1.7");
        let template = dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "ColorSpace" => "DeviceGray",
            "BitsPerComponent" => 8, "Width" => 32, "Height" => 32,
        };
        let mut raster = gray(32, 32);
        let black = raster.black();
        raster.fill((4, 4, 20, 20), &black);
        let flate = encode_flate(&raster, &template);
        let decoded = decode(&doc, &flate).unwrap();
        assert_eq!(decoded.source, Source::Flate);
        assert_eq!(decoded.pixels, raster.pixels);
        assert!(decoded.is_black((4, 4, 20, 20), 0) && !decoded.is_black((0, 0, 4, 4), 0));

        let jpeg = encode_jpeg(&raster, &template, 90).unwrap();
        let decoded = decode(&doc, &jpeg).unwrap();
        assert_eq!(
            (decoded.source, decoded.width, decoded.height),
            (Source::Jpeg, 32, 32)
        );
        assert!(decoded.is_black((6, 6, 18, 18), 40));
    }

    #[test]
    fn unsupported_images_are_rejected_and_resampling_averages() {
        let doc = Document::with_version("1.7");
        let stencil = Stream::new(
            dictionary! {"ImageMask" => true, "Width" => 1, "Height" => 1},
            vec![0],
        );
        assert!(decode(&doc, &stencil).is_err());
        let indexed = Stream::new(
            dictionary! {"Width" => 1, "Height" => 1, "BitsPerComponent" => 8,
            "ColorSpace" => vec![Object::Name(b"Indexed".to_vec())]},
            vec![0],
        );
        assert!(decode(&doc, &indexed).is_err());
        let raster = Raster {
            width: 2,
            height: 2,
            components: 1,
            pixels: vec![0, 100, 200, 100],
            source: Source::Raw,
        };
        assert_eq!(raster.resample(1, 1).pixels, vec![100]);
    }
}
