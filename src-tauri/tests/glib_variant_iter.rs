//! Exercise the backported out-pointer fix with optimizations enabled in Linux CI.
#![cfg(target_os = "linux")]

use glib::prelude::*;

#[test]
fn variant_string_iteration_preserves_values_in_both_directions() {
    let values = ["first", "", "日本語", "last"];
    let variant = values.to_variant();
    let iter = || variant.array_iter_str().expect("string array");
    assert_eq!(iter().collect::<Vec<_>>(), values);
    assert_eq!(
        iter().rev().collect::<Vec<_>>(),
        ["last", "日本語", "", "first"]
    );
    assert_eq!(iter().nth(2), Some("日本語"));
    assert_eq!(iter().nth_back(2), Some(""));
    assert_eq!(iter().last(), Some("last"));
    let mut mixed = iter();
    assert_eq!(mixed.next(), Some("first"));
    assert_eq!(mixed.next_back(), Some("last"));
    assert_eq!(mixed.next_back(), Some("日本語"));
    assert_eq!(mixed.next(), Some(""));
    assert_eq!(mixed.next(), None);
    assert_eq!(mixed.next_back(), None);
}
