//! A generated sRGB ICC profile (version 2.1, display class) for PDF/A output intents, so no
//! profile file has to be shipped or downloaded. Primaries and white point are the D50-adapted
//! sRGB values; the tone curve is the sRGB transfer function sampled at 1024 points.

const CURVE_POINTS: usize = 1024;

fn s15_fixed16(value: f64) -> [u8; 4] {
    ((value * 65536.0).round() as i32).to_be_bytes()
}

fn xyz(x: f64, y: f64, z: f64) -> Vec<u8> {
    let mut tag = b"XYZ \0\0\0\0".to_vec();
    for value in [x, y, z] {
        tag.extend(s15_fixed16(value));
    }
    tag
}

fn text_description(text: &str) -> Vec<u8> {
    let mut tag = b"desc\0\0\0\0".to_vec();
    tag.extend(((text.len() + 1) as u32).to_be_bytes());
    tag.extend(text.as_bytes());
    tag.push(0);
    // No Unicode or ScriptCode description.
    tag.extend([0_u8; 8]);
    tag.extend([0_u8; 3]);
    tag.extend([0_u8; 67]);
    tag
}

fn text(text: &str) -> Vec<u8> {
    let mut tag = b"text\0\0\0\0".to_vec();
    tag.extend(text.as_bytes());
    tag.push(0);
    tag
}

/// The sRGB transfer function from encoded to linear values.
fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn curve() -> Vec<u8> {
    let mut tag = b"curv\0\0\0\0".to_vec();
    tag.extend((CURVE_POINTS as u32).to_be_bytes());
    for index in 0..CURVE_POINTS {
        let linear = srgb_to_linear(index as f64 / (CURVE_POINTS - 1) as f64);
        tag.extend(((linear * 65535.0).round() as u16).to_be_bytes());
    }
    tag
}

/// The profile's bytes.
pub fn srgb_profile() -> Vec<u8> {
    let curve = curve();
    let tags: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"desc", text_description("sRGB IEC61966-2.1 (NavPDF)")),
        (b"cprt", text("No copyright, use freely")),
        (b"wtpt", xyz(0.9642, 1.0, 0.8249)),
        (b"rXYZ", xyz(0.4361, 0.2225, 0.0139)),
        (b"gXYZ", xyz(0.3851, 0.7169, 0.0971)),
        (b"bXYZ", xyz(0.1431, 0.0606, 0.7141)),
        (b"rTRC", curve.clone()),
        (b"gTRC", curve.clone()),
        (b"bTRC", curve),
    ];
    let table_length = 4 + tags.len() * 12;
    let mut table = (tags.len() as u32).to_be_bytes().to_vec();
    let mut data = Vec::new();
    for (signature, tag) in &tags {
        let offset = 128 + table_length + data.len();
        table.extend(*signature);
        table.extend((offset as u32).to_be_bytes());
        table.extend((tag.len() as u32).to_be_bytes());
        data.extend(tag);
        // Tag data starts on four-byte boundaries.
        while data.len() % 4 != 0 {
            data.push(0);
        }
    }
    let size = 128 + table_length + data.len();
    let mut header = Vec::with_capacity(128);
    header.extend((size as u32).to_be_bytes());
    header.extend([0_u8; 4]); // preferred CMM
    header.extend([0x02, 0x10, 0, 0]); // version 2.1
    header.extend(b"mntrRGB XYZ ");
    header.extend([0x07, 0xE2, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]); // 2018-01-01 00:00:00
    header.extend(b"acsp");
    header.extend([0_u8; 4]); // platform
    header.extend([0_u8; 4]); // flags
    header.extend([0_u8; 8]); // manufacturer and model
    header.extend([0_u8; 8]); // attributes
    header.extend([0_u8; 4]); // perceptual intent
    for value in [0.9642, 1.0, 0.8249] {
        header.extend(s15_fixed16(value));
    }
    header.extend([0_u8; 4]); // creator
    header.extend([0_u8; 16]); // profile ID
    header.extend([0_u8; 28]); // reserved
    let mut profile = header;
    profile.extend(table);
    profile.extend(data);
    profile
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u32_at(bytes: &[u8], offset: usize) -> u32 {
        u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    #[test]
    fn the_profile_header_and_tag_table_are_consistent() {
        let profile = srgb_profile();
        assert_eq!(u32_at(&profile, 0) as usize, profile.len());
        assert_eq!(&profile[12..24], b"mntrRGB XYZ ");
        assert_eq!(&profile[36..40], b"acsp");
        let count = u32_at(&profile, 128) as usize;
        assert_eq!(count, 9);
        for index in 0..count {
            let entry = 132 + index * 12;
            let (offset, size) = (u32_at(&profile, entry + 4), u32_at(&profile, entry + 8));
            assert_eq!(offset % 4, 0);
            assert!((offset + size) as usize <= profile.len());
            let kind = &profile[offset as usize..offset as usize + 4];
            assert!([b"desc", b"text", b"XYZ ", b"curv"]
                .iter()
                .any(|known| kind == *known));
        }
        // The curve maps black to 0, mid-grey to about 21.4% and white to 1.
        let start = profile
            .windows(4)
            .position(|window| window == b"curv")
            .unwrap()
            + 12;
        let sample = |index: usize| {
            u16::from_be_bytes([profile[start + index * 2], profile[start + index * 2 + 1]])
        };
        assert_eq!(sample(0), 0);
        assert_eq!(sample(CURVE_POINTS - 1), 65535);
        let middle = f64::from(sample(511)) / 65535.0;
        assert!((middle - 0.2140).abs() < 0.002, "{middle}");
    }
}
