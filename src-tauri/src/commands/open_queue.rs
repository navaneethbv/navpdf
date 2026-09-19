use serde::Serialize;
use std::{collections::VecDeque, path::PathBuf, sync::Mutex};

const MAX_PENDING: usize = 32;

/// Installed on Builder before setup: macOS can deliver Opened before Ready.
#[derive(Default)]
pub struct PendingOpenRequests(pub Mutex<OpenQueue>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub token: String,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct OpenQueue(VecDeque<(OpenRequest, Option<PathBuf>)>);

impl OpenQueue {
    pub fn push(&mut self, paths: Vec<PathBuf>) -> Result<OpenRequest, String> {
        if self.0.len() >= MAX_PENDING {
            return Err("The open queue is full. Finish pending requests and try again.".into());
        }
        let (path, error) = if paths.len() != 1 {
            (None, Some("Open one PDF at a time.".into()))
        } else if !super::is_pdf_path(&paths[0]) {
            (None, Some("Only PDF files can be opened.".into()))
        } else {
            (paths.into_iter().next(), None)
        };
        let request = OpenRequest {
            token: uuid::Uuid::new_v4().to_string(),
            error,
        };
        self.0.push_back((request.clone(), path));
        Ok(request)
    }

    pub fn pending(&self) -> Vec<OpenRequest> {
        self.0.iter().map(|(request, _)| request.clone()).collect()
    }

    pub fn take(&mut self, token: &str) -> Result<PathBuf, String> {
        let index = self
            .0
            .iter()
            .position(|(request, _)| request.token == token)
            .ok_or("This open request has expired or was already used.")?;
        let (request, path) = self
            .0
            .remove(index)
            .expect("index exists under exclusive access");
        path.ok_or_else(|| {
            request
                .error
                .unwrap_or_else(|| "Invalid open request.".into())
        })
    }

    pub fn dismiss(&mut self, token: &str) {
        self.0.retain(|(request, _)| request.token != token);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_requests_until_consumed_in_arrival_order_without_exposing_paths() {
        let mut queue = OpenQueue::default();
        let first = queue
            .push(vec![PathBuf::from("/private/first.PDF")])
            .unwrap();
        let second = queue
            .push(vec![PathBuf::from("/private/second.pdf")])
            .unwrap();
        assert_eq!(queue.pending()[0].token, first.token);
        assert_eq!(queue.pending()[1].token, second.token);
        let serialized = serde_json::to_string(&queue.pending()).unwrap();
        assert!(!serialized.contains("private"));
        assert_eq!(
            queue.take(&first.token).unwrap(),
            PathBuf::from("/private/first.PDF")
        );
        assert!(queue.take(&first.token).is_err());
        queue.dismiss(&second.token);
        queue.dismiss(&second.token);
        assert!(queue.pending().is_empty());
    }

    #[test]
    fn retains_invalid_and_multiple_file_errors_for_startup_delivery() {
        let mut queue = OpenQueue::default();
        let invalid = queue.push(vec![PathBuf::from("image.png")]).unwrap();
        let batch = queue
            .push(vec![PathBuf::from("a.pdf"), PathBuf::from("b.pdf")])
            .unwrap();
        assert_eq!(
            queue.take(&invalid.token).unwrap_err(),
            "Only PDF files can be opened."
        );
        assert_eq!(
            queue.take(&batch.token).unwrap_err(),
            "Open one PDF at a time."
        );
        assert!(queue.pending().is_empty());
    }

    #[test]
    fn bounds_pending_requests_and_releases_capacity_on_cancel() {
        let mut queue = OpenQueue::default();
        for _ in 0..MAX_PENDING {
            queue.push(vec![PathBuf::from("a.pdf")]).unwrap();
        }
        assert!(queue.push(vec![PathBuf::from("b.pdf")]).is_err());
        let first = queue.pending()[0].token.clone();
        queue.dismiss(&first);
        assert!(queue.push(vec![PathBuf::from("b.pdf")]).is_ok());
        assert!(queue.take("not-an-issued-token").is_err());
        assert_eq!(queue.pending().len(), MAX_PENDING);
    }
}
