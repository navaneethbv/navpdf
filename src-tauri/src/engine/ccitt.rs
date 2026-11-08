//! CCITT Group 4 (ITU-T T.6) encoding of 1-bit images, as PDF's CCITTFaxDecode filter reads it
//! with `K -1` and the default `BlackIs1 false`: a 0 sample is black and a 1 sample white.

/// (run length, code length, code) for terminating codes 0 to 63.
const WHITE_TERMINATING: [(u16, u32); 64] = [
    (8, 0b00110101),
    (6, 0b000111),
    (4, 0b0111),
    (4, 0b1000),
    (4, 0b1011),
    (4, 0b1100),
    (4, 0b1110),
    (4, 0b1111),
    (5, 0b10011),
    (5, 0b10100),
    (5, 0b00111),
    (5, 0b01000),
    (6, 0b001000),
    (6, 0b000011),
    (6, 0b110100),
    (6, 0b110101),
    (6, 0b101010),
    (6, 0b101011),
    (7, 0b0100111),
    (7, 0b0001100),
    (7, 0b0001000),
    (7, 0b0010111),
    (7, 0b0000011),
    (7, 0b0000100),
    (7, 0b0101000),
    (7, 0b0101011),
    (7, 0b0010011),
    (7, 0b0100100),
    (7, 0b0011000),
    (8, 0b00000010),
    (8, 0b00000011),
    (8, 0b00011010),
    (8, 0b00011011),
    (8, 0b00010010),
    (8, 0b00010011),
    (8, 0b00010100),
    (8, 0b00010101),
    (8, 0b00010110),
    (8, 0b00010111),
    (8, 0b00101000),
    (8, 0b00101001),
    (8, 0b00101010),
    (8, 0b00101011),
    (8, 0b00101100),
    (8, 0b00101101),
    (8, 0b00000100),
    (8, 0b00000101),
    (8, 0b00001010),
    (8, 0b00001011),
    (8, 0b01010010),
    (8, 0b01010011),
    (8, 0b01010100),
    (8, 0b01010101),
    (8, 0b00100100),
    (8, 0b00100101),
    (8, 0b01011000),
    (8, 0b01011001),
    (8, 0b01011010),
    (8, 0b01011011),
    (8, 0b01001010),
    (8, 0b01001011),
    (8, 0b00110010),
    (8, 0b00110011),
    (8, 0b00110100),
];

const BLACK_TERMINATING: [(u16, u32); 64] = [
    (10, 0b0000110111),
    (3, 0b010),
    (2, 0b11),
    (2, 0b10),
    (3, 0b011),
    (4, 0b0011),
    (4, 0b0010),
    (5, 0b00011),
    (6, 0b000101),
    (6, 0b000100),
    (7, 0b0000100),
    (7, 0b0000101),
    (7, 0b0000111),
    (8, 0b00000100),
    (8, 0b00000111),
    (9, 0b000011000),
    (10, 0b0000010111),
    (10, 0b0000011000),
    (10, 0b0000001000),
    (11, 0b00001100111),
    (11, 0b00001101000),
    (11, 0b00001101100),
    (11, 0b00000110111),
    (11, 0b00000101000),
    (11, 0b00000010111),
    (11, 0b00000011000),
    (12, 0b000011001010),
    (12, 0b000011001011),
    (12, 0b000011001100),
    (12, 0b000011001101),
    (12, 0b000001101000),
    (12, 0b000001101001),
    (12, 0b000001101010),
    (12, 0b000001101011),
    (12, 0b000011010010),
    (12, 0b000011010011),
    (12, 0b000011010100),
    (12, 0b000011010101),
    (12, 0b000011010110),
    (12, 0b000011010111),
    (12, 0b000001101100),
    (12, 0b000001101101),
    (12, 0b000011011010),
    (12, 0b000011011011),
    (12, 0b000001010100),
    (12, 0b000001010101),
    (12, 0b000001010110),
    (12, 0b000001010111),
    (12, 0b000001100100),
    (12, 0b000001100101),
    (12, 0b000001010010),
    (12, 0b000001010011),
    (12, 0b000000100100),
    (12, 0b000000110111),
    (12, 0b000000111000),
    (12, 0b000000100111),
    (12, 0b000000101000),
    (12, 0b000001011000),
    (12, 0b000001011001),
    (12, 0b000000101011),
    (12, 0b000000101100),
    (12, 0b000001011010),
    (12, 0b000001100110),
    (12, 0b000001100111),
];

/// Make-up codes for 64 to 1728 in steps of 64.
const WHITE_MAKEUP: [(u16, u32); 27] = [
    (5, 0b11011),
    (5, 0b10010),
    (6, 0b010111),
    (7, 0b0110111),
    (8, 0b00110110),
    (8, 0b00110111),
    (8, 0b01100100),
    (8, 0b01100101),
    (8, 0b01101000),
    (8, 0b01100111),
    (9, 0b011001100),
    (9, 0b011001101),
    (9, 0b011010010),
    (9, 0b011010011),
    (9, 0b011010100),
    (9, 0b011010101),
    (9, 0b011010110),
    (9, 0b011010111),
    (9, 0b011011000),
    (9, 0b011011001),
    (9, 0b011011010),
    (9, 0b011011011),
    (9, 0b010011000),
    (9, 0b010011001),
    (9, 0b010011010),
    (6, 0b011000),
    (9, 0b010011011),
];

const BLACK_MAKEUP: [(u16, u32); 27] = [
    (10, 0b0000001111),
    (12, 0b000011001000),
    (12, 0b000011001001),
    (12, 0b000001011011),
    (12, 0b000000110011),
    (12, 0b000000110100),
    (12, 0b000000110101),
    (13, 0b0000001101100),
    (13, 0b0000001101101),
    (13, 0b0000001001010),
    (13, 0b0000001001011),
    (13, 0b0000001001100),
    (13, 0b0000001001101),
    (13, 0b0000001110010),
    (13, 0b0000001110011),
    (13, 0b0000001110100),
    (13, 0b0000001110101),
    (13, 0b0000001110110),
    (13, 0b0000001110111),
    (13, 0b0000001010010),
    (13, 0b0000001010011),
    (13, 0b0000001010100),
    (13, 0b0000001010101),
    (13, 0b0000001011010),
    (13, 0b0000001011011),
    (13, 0b0000001100100),
    (13, 0b0000001100101),
];

/// Make-up codes shared by both colours for 1792 to 2560 in steps of 64.
const EXTENDED_MAKEUP: [(u16, u32); 13] = [
    (11, 0b00000001000),
    (11, 0b00000001100),
    (11, 0b00000001101),
    (12, 0b000000010010),
    (12, 0b000000010011),
    (12, 0b000000010100),
    (12, 0b000000010101),
    (12, 0b000000010110),
    (12, 0b000000010111),
    (12, 0b000000011100),
    (12, 0b000000011101),
    (12, 0b000000011110),
    (12, 0b000000011111),
];

/// The widest image encoded; rows are walked as lists of colour changes.
pub const MAX_WIDTH: usize = 1 << 16;

struct BitWriter {
    bytes: Vec<u8>,
    current: u32,
    filled: u32,
}

impl BitWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            current: 0,
            filled: 0,
        }
    }

    fn put(&mut self, length: u16, code: u32) {
        for shift in (0..u32::from(length)).rev() {
            self.current = (self.current << 1) | ((code >> shift) & 1);
            self.filled += 1;
            if self.filled == 8 {
                self.bytes.push(self.current as u8);
                self.current = 0;
                self.filled = 0;
            }
        }
    }

    fn finish(mut self) -> Vec<u8> {
        if self.filled > 0 {
            self.bytes.push((self.current << (8 - self.filled)) as u8);
        }
        self.bytes
    }
}

fn put_run(writer: &mut BitWriter, mut run: usize, black: bool) {
    while run >= 2560 {
        let (length, code) = EXTENDED_MAKEUP[12];
        writer.put(length, code);
        run -= 2560;
    }
    if run >= 64 {
        let steps = run / 64;
        let (length, code) = if steps >= 28 {
            EXTENDED_MAKEUP[steps - 28]
        } else if black {
            BLACK_MAKEUP[steps - 1]
        } else {
            WHITE_MAKEUP[steps - 1]
        };
        writer.put(length, code);
        run %= 64;
    }
    let (length, code) = if black {
        BLACK_TERMINATING[run]
    } else {
        WHITE_TERMINATING[run]
    };
    writer.put(length, code);
}

/// Positions where a row's colour changes, starting from an imaginary white pixel before it,
/// followed by two `width` sentinels.
fn changes(row: &[bool], width: usize, out: &mut Vec<usize>) {
    out.clear();
    let mut black = false;
    for (index, pixel) in row.iter().enumerate().take(width) {
        if *pixel != black {
            out.push(index);
            black = *pixel;
        }
    }
    out.push(width);
    out.push(width);
}

/// Encodes rows of `width` packed 1-bit samples (most significant bit first, rows padded to a
/// byte) as CCITT Group 4 with an end-of-block marker.
pub fn encode_g4(packed: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    if width == 0 || width > MAX_WIDTH || height == 0 {
        return None;
    }
    let stride = width.div_ceil(8);
    if packed.len() < stride.checked_mul(height)? {
        return None;
    }
    let mut writer = BitWriter::new();
    let mut reference = vec![width, width];
    let mut coding = Vec::with_capacity(width + 2);
    let mut row = vec![false; width];
    for y in 0..height {
        let bytes = &packed[y * stride..(y + 1) * stride];
        for (x, pixel) in row.iter_mut().enumerate() {
            // A 0 sample is black.
            *pixel = bytes[x / 8] & (0x80 >> (x % 8)) == 0;
        }
        changes(&row, width, &mut coding);
        let mut a0: isize = -1;
        let mut black = false;
        // Index of the first change in each list that may be to the right of a0.
        let mut ci = 0;
        let mut ri = 0;
        while a0 < width as isize {
            while coding[ci] < width && coding[ci] as isize <= a0 {
                ci += 1;
            }
            let a1 = coding[ci];
            let a2 = coding[(ci + 1).min(coding.len() - 1)];
            // b1 is the first change on the reference row after a0 to the colour opposite a0's;
            // changes alternate, to black at even positions and to white at odd ones.
            while reference[ri] < width && (reference[ri] as isize <= a0 || (ri % 2 == 1) != black)
            {
                ri += 1;
            }
            let b1 = reference[ri];
            let b2 = reference[(ri + 1).min(reference.len() - 1)];
            if b2 < a1 {
                writer.put(4, 0b0001);
                a0 = b2 as isize;
            } else {
                let delta = a1 as isize - b1 as isize;
                if delta.abs() <= 3 {
                    let (length, code) = match delta {
                        0 => (1, 0b1),
                        1 => (3, 0b011),
                        2 => (6, 0b000011),
                        3 => (7, 0b0000011),
                        -1 => (3, 0b010),
                        -2 => (6, 0b000010),
                        _ => (7, 0b0000010),
                    };
                    writer.put(length, code);
                    a0 = a1 as isize;
                    black = !black;
                } else {
                    writer.put(3, 0b001);
                    let start = a0.max(0) as usize;
                    put_run(&mut writer, a1 - start, black);
                    put_run(&mut writer, a2 - a1, !black);
                    a0 = a2 as isize;
                }
            }
            // Searching restarts a little behind, since b1 may lie left of the previous one.
            ri = ri.saturating_sub(2);
        }
        std::mem::swap(&mut reference, &mut coding);
    }
    // End of facsimile block: two EOL codes.
    writer.put(12, 1);
    writer.put(12, 1);
    Some(writer.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack(rows: &[&str]) -> (Vec<u8>, usize, usize) {
        let width = rows[0].len();
        let stride = width.div_ceil(8);
        let mut packed = vec![0u8; stride * rows.len()];
        for (y, row) in rows.iter().enumerate() {
            for (x, cell) in row.chars().enumerate() {
                // "." is white (1), "#" black (0).
                if cell == '.' {
                    packed[y * stride + x / 8] |= 0x80 >> (x % 8);
                }
            }
        }
        (packed, width, rows.len())
    }

    #[test]
    fn all_white_rows_are_one_vertical_code_each() {
        let (packed, width, height) = pack(&["........", "........"]);
        // V0 per row (white to the end matches the imaginary reference), then EOFB.
        let encoded = encode_g4(&packed, width, height).unwrap();
        assert_eq!(encoded[0] >> 6, 0b11);
    }

    fn pattern(width: usize, height: usize, black: impl Fn(usize, usize) -> bool) -> Vec<u8> {
        let stride = width.div_ceil(8);
        let mut packed = vec![0u8; stride * height];
        for y in 0..height {
            for x in 0..width {
                if !black(x, y) {
                    packed[y * stride + x / 8] |= 0x80 >> (x % 8);
                }
            }
        }
        packed
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// Reference streams from libtiff's Group 4 encoder (Pillow 12.3) for the same pixels.
    /// The first also decoded through poppler to exactly these pixels; see the verification ledger.
    #[test]
    fn matches_libtiff_group4_output() {
        let mixed = pattern(61, 23, |x, y| ((x / (y + 3)) + (x * x / 17) + y) % 5 == 0);
        assert_eq!(
            hex(&encode_g4(&mixed, 61, 23).unwrap()),
            "26b1c45d174474474611c46335a3088ea23f8891d084084c22e8c249219ec7c74858260994e1288e\
474716a2c108b388da1c20bdca1726a69184210588205e3c4522e84584cac2bcd799a4848e8e2040b655\
cbad28484102123a111b740b308105410820424746d022a20e97a93533881021040844595ad24b14b04\
0848e88e88e8e26506b1692420810888204cab290928492123a30820982b65688c20950425d0841088bb\
359a108c9a99c4247408109b408132bc1661020a290204391d11d04108b2b55a4a92408108889745d32\
83496c249091d1c4104c2655948490d042081091d088b2acaf491841293533884102123a3681026559ac\
248462902042081084108b2b9246d020a924081091d04165d174ca4e9250010010"
        );
        // Runs longer than 2,560 pixels use the shared extended make-up codes.
        let wide = pattern(3000, 4, |x, y| (5..2700 + y * 10).contains(&x));
        assert_eq!(
            hex(&encode_g4(&wide, 3000, 4).unwrap()),
            "3803e1903c80f864030dc4e407c32032dba8901f0c80d56fa0008008"
        );
    }

    #[test]
    fn rejects_empty_or_truncated_input() {
        assert!(encode_g4(&[], 0, 1).is_none());
        assert!(encode_g4(&[0xff], 16, 1).is_none());
    }
}
