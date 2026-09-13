pub fn valid_range(begin: u64, end: u64, length: u64) -> bool {
    begin < end && end <= length && end - begin <= crate::filesystem::MAX_RANGE_BYTES
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_are_bounded() {
        assert!(valid_range(0, 100, 100));
        assert!(!valid_range(100, 0, 100));
        assert!(!valid_range(0, 101, 100));
        assert!(!valid_range(0, 5 * 1024 * 1024, 10 * 1024 * 1024));
    }
}
