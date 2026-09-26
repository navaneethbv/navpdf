/// Decodes locally through ImageIO. The bounded binary result contains PNG frames.
pub fn decode(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.is_empty() || bytes.len() > 25 * 1024 * 1024 {
        return Err("Image import requires a file between 1 byte and 25 MB.".into());
    }
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn navpdf_decode_images(bytes: *const u8, count: usize, length: *mut usize) -> *mut u8;
            fn navpdf_free_images(bytes: *mut u8);
        }
        struct DecodedBuffer(std::ptr::NonNull<u8>);
        impl Drop for DecodedBuffer {
            fn drop(&mut self) {
                // SAFETY: This pointer is the unique allocation returned by our Swift decoder.
                // Its matching Swift deallocator runs exactly once, including on early returns.
                // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage
                unsafe { navpdf_free_images(self.0.as_ptr()) };
            }
        }
        let mut length = 0usize;
        // SAFETY: The input slice and writable length live throughout the synchronous call.
        // Swift copies the input, retains neither pointer, and returns its allocation size.
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage
        let pointer = unsafe { navpdf_decode_images(bytes.as_ptr(), bytes.len(), &mut length) };
        let buffer = DecodedBuffer(
            std::ptr::NonNull::new(pointer)
                .ok_or_else(|| "Image decoder returned no data.".to_string())?,
        );
        if !(4..=100 * 1024 * 1024).contains(&length) {
            return Err("Image decoder returned an invalid size.".into());
        }
        // SAFETY: Our Swift implementation initializes exactly length bytes, with no aliases.
        // The validated length fits isize; buffer owns the allocation until copying completes.
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage
        let result = unsafe { std::slice::from_raw_parts(buffer.0.as_ptr(), length).to_vec() };
        if result[..4] == [0, 0, 0, 0] {
            return Err(String::from_utf8_lossy(&result[4..]).into_owned());
        }
        Ok(result)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("HEIC and TIFF import currently requires macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    fn tiff(width: u32, height: u32, pages: u32, orientation: u32) -> Vec<u8> {
        let mut data = b"II\x2a\x00\x08\x00\x00\x00".to_vec();
        let ifd_size = 2 + 10 * 12 + 4;
        for page in 0..pages {
            let offset = 8 + page * (ifd_size + 6);
            data.extend_from_slice(&10u16.to_le_bytes());
            for (tag, value) in [
                (256u16, width),
                (257, height),
                (258, 8),
                (259, 1),
                (262, 1),
                (273, offset + ifd_size),
                (274, orientation),
                (277, 1),
                (278, height),
                (279, 6),
            ] {
                data.extend_from_slice(&tag.to_le_bytes());
                data.extend_from_slice(
                    &(if [258, 259, 262, 274, 277].contains(&tag) {
                        3u16
                    } else {
                        4u16
                    })
                    .to_le_bytes(),
                );
                data.extend_from_slice(&1u32.to_le_bytes());
                data.extend_from_slice(&value.to_le_bytes());
            }
            let next = if page + 1 < pages {
                offset + ifd_size + 6
            } else {
                0
            };
            data.extend_from_slice(&next.to_le_bytes());
            data.extend_from_slice(&[0, 64, 128, 192, 224, 255]);
        }
        data
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn imports_every_tiff_page_with_orientation() {
        let output = super::decode(&tiff(2, 3, 2, 6)).unwrap();
        assert_eq!(u32::from_be_bytes(output[..4].try_into().unwrap()), 2);
        let mut offset = 4;
        for _ in 0..2 {
            let length =
                u32::from_be_bytes(output[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4;
            assert_eq!(&output[offset..offset + 8], b"\x89PNG\r\n\x1a\n");
            assert_eq!(
                u32::from_be_bytes(output[offset + 16..offset + 20].try_into().unwrap()),
                3
            );
            assert_eq!(
                u32::from_be_bytes(output[offset + 20..offset + 24].try_into().unwrap()),
                2
            );
            offset += length;
        }
        assert_eq!(offset, output.len());
        assert!(super::decode(&tiff(32768, 1, 1, 1))
            .unwrap_err()
            .contains("limit"));
    }
    #[test]
    fn rejects_invalid_inputs() {
        assert!(super::decode(&[]).is_err());
        assert!(super::decode(&vec![0; 25 * 1024 * 1024 + 1]).is_err());
        assert!(super::decode(b"not an image").is_err());
    }
}
