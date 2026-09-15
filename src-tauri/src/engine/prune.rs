//! Unreferenced object removal, object renumbering and stream compression.

pub fn prune(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut doc = super::load(bytes)?;
    doc.prune_objects();
    doc.renumber_objects();
    doc.compress();
    super::save(&mut doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object, Stream};

    fn two_page_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let c1 = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf (Page 1) Tj ET".to_vec(),
        ));
        let p1 = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages,
            "MediaBox" => vec![0.into(), 0.into(), 300.into(), 400.into()],
            "Contents" => c1,
        });
        let c2 = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf (Page 2) Tj ET".to_vec(),
        ));
        let p2 = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages,
            "MediaBox" => vec![0.into(), 0.into(), 300.into(), 400.into()],
            "Contents" => c2,
        });
        doc.objects.insert(
            pages,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![p1.into(), p2.into()],
                "Count" => 2,
            }),
        );
        let catalog = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages,
        });
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("serialization");
        bytes
    }

    fn detach_second_page(doc: &mut Document) {
        let pages_id = doc
            .catalog()
            .and_then(|cat| cat.get(b"Pages"))
            .and_then(Object::as_reference)
            .unwrap();
        let pages = doc.get_dictionary_mut(pages_id).unwrap();
        let kids = pages
            .get_mut(b"Kids")
            .and_then(Object::as_array_mut)
            .unwrap();
        kids.pop();
        pages.set("Count", 1);
    }

    #[test]
    fn prune_drops_unreferenced_page_objects() {
        let mut doc = Document::load_mem(&two_page_pdf()).unwrap();
        detach_second_page(&mut doc);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        let pruned = prune(&bytes).unwrap();
        let count = |b: &[u8]| {
            Document::load_mem(b)
                .unwrap()
                .objects
                .values()
                .filter(|o| o.type_name().ok() == Some(b"Page"))
                .count()
        };
        assert_eq!(count(&bytes), 2);
        assert_eq!(count(&pruned), 1);
    }
}
