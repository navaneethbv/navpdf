//! Affine matrices and rectangles in PDF user space.

use lopdf::Object;
use serde::{Deserialize, Serialize};

/// A PDF transformation matrix `[a b c d e f]` using row-vector notation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    pub const IDENTITY: Matrix = Matrix {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    pub fn new(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Self {
        Self { a, b, c, d, e, f }
    }

    pub fn translate(tx: f64, ty: f64) -> Self {
        Self::new(1.0, 0.0, 0.0, 1.0, tx, ty)
    }

    /// Reads six finite numeric operands.
    pub fn from_objects(values: &[Object]) -> Option<Self> {
        if values.len() != 6 {
            return None;
        }
        let mut v = [0.0; 6];
        for (slot, value) in v.iter_mut().zip(values) {
            *slot = number(value)?;
        }
        Some(Self::new(v[0], v[1], v[2], v[3], v[4], v[5]))
    }

    /// Applies `self` first and then `next` (`self × next`).
    pub fn then(&self, next: &Matrix) -> Matrix {
        Matrix {
            a: self.a * next.a + self.b * next.c,
            b: self.a * next.b + self.b * next.d,
            c: self.c * next.a + self.d * next.c,
            d: self.c * next.b + self.d * next.d,
            e: self.e * next.a + self.f * next.c + next.e,
            f: self.e * next.b + self.f * next.d + next.f,
        }
    }

    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        (
            x * self.a + y * self.c + self.e,
            x * self.b + y * self.d + self.f,
        )
    }

    pub fn invert(&self) -> Option<Matrix> {
        let det = self.a * self.d - self.b * self.c;
        if !det.is_finite() || det.abs() < 1e-12 {
            return None;
        }
        let (a, b, c, d) = (self.d / det, -self.b / det, -self.c / det, self.a / det);
        Some(Matrix {
            a,
            b,
            c,
            d,
            e: -(self.e * a + self.f * c),
            f: -(self.e * b + self.f * d),
        })
    }

    /// The axis-aligned bounds of a transformed rectangle.
    pub fn transform_rect(&self, rect: &Rect) -> Rect {
        Rect::bounding([
            self.apply(rect.x0, rect.y0),
            self.apply(rect.x1, rect.y0),
            self.apply(rect.x0, rect.y1),
            self.apply(rect.x1, rect.y1),
        ])
    }

    /// User-space length of the transformed unit x vector.
    pub fn scale_x(&self) -> f64 {
        self.a.hypot(self.b)
    }

    /// User-space length of the transformed unit y vector.
    pub fn scale_y(&self) -> f64 {
        self.c.hypot(self.d)
    }
}

/// A finite PDF number.
pub fn number(value: &Object) -> Option<f64> {
    let value = match value {
        Object::Integer(v) => *v as f64,
        Object::Real(v) => *v as f64,
        _ => return None,
    };
    value.is_finite().then_some(value)
}

/// A normalized axis-aligned rectangle.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Rect {
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Self {
        Self {
            x0: x0.min(x1),
            y0: y0.min(y1),
            x1: x0.max(x1),
            y1: y0.max(y1),
        }
    }

    pub fn bounding(points: impl IntoIterator<Item = (f64, f64)>) -> Self {
        let mut rect = Rect {
            x0: f64::INFINITY,
            y0: f64::INFINITY,
            x1: f64::NEG_INFINITY,
            y1: f64::NEG_INFINITY,
        };
        for (x, y) in points {
            rect.x0 = rect.x0.min(x);
            rect.y0 = rect.y0.min(y);
            rect.x1 = rect.x1.max(x);
            rect.y1 = rect.y1.max(y);
        }
        rect
    }

    pub fn from_objects(values: &[Object]) -> Option<Self> {
        if values.len() != 4 {
            return None;
        }
        Some(Rect::new(
            number(&values[0])?,
            number(&values[1])?,
            number(&values[2])?,
            number(&values[3])?,
        ))
    }

    pub fn is_valid(&self) -> bool {
        self.x0.is_finite() && self.y0.is_finite() && self.x1.is_finite() && self.y1.is_finite()
    }

    pub fn width(&self) -> f64 {
        self.x1 - self.x0
    }

    pub fn height(&self) -> f64 {
        self.y1 - self.y0
    }

    /// True when the rectangles share a region of positive area.
    pub fn overlaps(&self, other: &Rect) -> bool {
        self.x0 < other.x1 && other.x0 < self.x1 && self.y0 < other.y1 && other.y0 < self.y1
    }

    pub fn contains(&self, other: &Rect) -> bool {
        self.x0 <= other.x0 && self.y0 <= other.y0 && self.x1 >= other.x1 && self.y1 >= other.y1
    }

    pub fn inflate(&self, amount: f64) -> Rect {
        Rect::new(
            self.x0 - amount,
            self.y0 - amount,
            self.x1 + amount,
            self.y1 + amount,
        )
    }

    /// Grows a degenerate rectangle so area-based tests still see it.
    pub fn with_min_extent(&self, extent: f64) -> Rect {
        let grow_x = ((extent - self.width()) / 2.0).max(0.0);
        let grow_y = ((extent - self.height()) / 2.0).max(0.0);
        Rect::new(
            self.x0 - grow_x,
            self.y0 - grow_y,
            self.x1 + grow_x,
            self.y1 + grow_y,
        )
    }

    pub fn union(&self, other: &Rect) -> Rect {
        Rect {
            x0: self.x0.min(other.x0),
            y0: self.y0.min(other.y0),
            x1: self.x1.max(other.x1),
            y1: self.y1.max(other.y1),
        }
    }

    pub fn to_array(self) -> [f64; 4] {
        [self.x0, self.y0, self.x1, self.y1]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix_composition_follows_pdf_order() {
        let scale = Matrix::new(2.0, 0.0, 0.0, 2.0, 0.0, 0.0);
        let shift = Matrix::translate(10.0, 5.0);
        // Scale first, then translate.
        assert_eq!(scale.then(&shift).apply(1.0, 1.0), (12.0, 7.0));
        // Translate first, then scale.
        assert_eq!(shift.then(&scale).apply(1.0, 1.0), (22.0, 12.0));
    }

    #[test]
    fn inverse_round_trips_points() {
        let m = Matrix::new(0.0, 1.0, -1.0, 0.0, 30.0, 40.0);
        let inverse = m.invert().unwrap();
        let (x, y) = m.apply(3.0, 7.0);
        let (bx, by) = inverse.apply(x, y);
        assert!((bx - 3.0).abs() < 1e-9 && (by - 7.0).abs() < 1e-9);
        assert!(Matrix::new(1.0, 2.0, 2.0, 4.0, 0.0, 0.0).invert().is_none());
    }

    #[test]
    fn rotated_rect_bounds_and_overlap() {
        let rotate = Matrix::new(0.0, 1.0, -1.0, 0.0, 0.0, 0.0);
        let bounds = rotate.transform_rect(&Rect::new(0.0, 0.0, 10.0, 2.0));
        assert_eq!(bounds, Rect::new(-2.0, 0.0, 0.0, 10.0));
        assert!(bounds.overlaps(&Rect::new(-1.0, 5.0, 3.0, 6.0)));
        assert!(!bounds.overlaps(&Rect::new(0.0, 0.0, 5.0, 5.0)));
        assert!(Rect::new(1.0, 1.0, 1.0, 1.0)
            .with_min_extent(0.1)
            .overlaps(&Rect::new(0.0, 0.0, 2.0, 2.0)));
    }
}
