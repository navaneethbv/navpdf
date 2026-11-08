//! An optional OCR engine: a Tesseract program the user installed, run as a separate process.
//!
//! The program gets fixed arguments, an allow-listed language code and a page image in a private
//! temporary folder. It runs with an empty environment (except `TESSDATA_PREFIX`), no input,
//! a time limit and a cap on its output. Nothing is downloaded; Tesseract's own language data
//! must already be installed. See ADR 0021.

use super::{OcrLine, OcrPageResult, OcrWord};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The longest a page may take.
const TIMEOUT: Duration = Duration::from_secs(120);
/// The most output read from the program.
const MAX_OUTPUT: usize = 16 * 1024 * 1024;

/// Tesseract language codes such as `eng`, `chi_sim` or `eng+deu`, up to five joined by `+`.
pub fn valid_language(language: &str) -> bool {
    let parts: Vec<&str> = language.split('+').collect();
    !language.is_empty()
        && parts.len() <= 5
        && parts.iter().all(|part| {
            let (code, script) = part.split_once('_').unwrap_or((part, ""));
            code.len() == 3
                && code.bytes().all(|b| b.is_ascii_lowercase())
                && (script.is_empty()
                    || (script.len() <= 8 && script.bytes().all(|b| b.is_ascii_lowercase())))
        })
}

/// The program to run: the chosen absolute path, or `tesseract` found on the search path.
pub fn program(configured: &str) -> Result<PathBuf, String> {
    let configured = configured.trim();
    if !configured.is_empty() {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err("Choose the Tesseract program by its full path.".into());
        }
        if !path.is_file() {
            return Err("The chosen Tesseract program was not found.".into());
        }
        return Ok(path);
    }
    let name = if cfg!(windows) {
        "tesseract.exe"
    } else {
        "tesseract"
    };
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "Tesseract was not found. Install it, or choose its program in Settings.".into()
        })
}

/// Runs the program with `args`, returning its output, within the time and size limits.
fn run(program: &Path, args: &[&std::ffi::OsStr], directory: &Path) -> Result<Vec<u8>, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(directory)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(data) = std::env::var_os("TESSDATA_PREFIX") {
        command.env("TESSDATA_PREFIX", data);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Tesseract could not be started.")?;
    let mut stdout = child.stdout.take().ok_or("Tesseract gave no output.")?;
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        let mut chunk = [0u8; 64 * 1024];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if output.len() + read > MAX_OUTPUT {
                        return Err(());
                    }
                    output.extend_from_slice(&chunk[..read]);
                }
            }
        }
        Ok(output)
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "Tesseract stopped unexpectedly.")?
        {
            break status;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Tesseract took longer than two minutes on this page.".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let output = reader
        .join()
        .map_err(|_| "Tesseract's output could not be read.")?
        .map_err(|_| "Tesseract's output was too large.")?;
    if !status.success() {
        return Err(
            "Tesseract could not read this page. Check that its language data is installed.".into(),
        );
    }
    Ok(output)
}

/// The width and height of a PNG from its header.
fn png_size(image: &[u8]) -> Result<(f32, f32), String> {
    if image.len() < 24 || &image[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("OCR requires a valid PNG page image.".into());
    }
    let width = u32::from_be_bytes(image[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(image[20..24].try_into().unwrap());
    Ok((width as f32, height as f32))
}

/// Words from Tesseract's TSV output grouped into lines, with boxes normalized and measured
/// from the bottom of the image as the other engine reports them.
pub fn parse_tsv(
    tsv: &str,
    width: f32,
    height: f32,
    page_index: usize,
    language: &str,
) -> OcrPageResult {
    let mut lines: Vec<(String, OcrLine)> = Vec::new();
    for row in tsv.lines().skip(1) {
        let columns: Vec<&str> = row.splitn(12, '\t').collect();
        if columns.len() < 12 || columns[0] != "5" {
            continue;
        }
        let text = columns[11].trim();
        let numbers: Option<Vec<f32>> = columns[6..11].iter().map(|v| v.parse().ok()).collect();
        let Some(&[left, top, w, h, confidence]) = numbers
            .as_deref()
            .and_then(|v| <&[f32; 5]>::try_from(v).ok())
        else {
            continue;
        };
        if text.is_empty() || confidence < 0.0 || w <= 0.0 || h <= 0.0 {
            continue;
        }
        let bbox = [
            (left / width).clamp(0.0, 1.0),
            (1.0 - (top + h) / height).clamp(0.0, 1.0),
            (w / width).clamp(0.0, 1.0),
            (h / height).clamp(0.0, 1.0),
        ];
        let word = OcrWord {
            text: text.to_string(),
            confidence: (confidence / 100.0).clamp(0.0, 1.0),
            bbox,
        };
        let key = columns[2..5].join(":");
        match lines.last_mut() {
            Some((last, line)) if *last == key => {
                let [x0, y0, w0, h0] = line.bbox;
                let x1 = (x0 + w0).max(bbox[0] + bbox[2]);
                let y1 = (y0 + h0).max(bbox[1] + bbox[3]);
                let x = x0.min(bbox[0]);
                let y = y0.min(bbox[1]);
                line.bbox = [x, y, x1 - x, y1 - y];
                line.text.push(' ');
                line.text.push_str(&word.text);
                line.words.push(word);
            }
            _ => lines.push((
                key,
                OcrLine {
                    text: word.text.clone(),
                    confidence: 0.0,
                    bbox,
                    words: vec![word],
                },
            )),
        }
    }
    let lines: Vec<OcrLine> = lines
        .into_iter()
        .map(|(_, mut line)| {
            line.confidence =
                line.words.iter().map(|w| w.confidence).sum::<f32>() / line.words.len() as f32;
            line
        })
        .collect();
    let words: Vec<&OcrWord> = lines.iter().flat_map(|line| &line.words).collect();
    let mean_confidence = if words.is_empty() {
        0.0
    } else {
        words.iter().map(|w| w.confidence).sum::<f32>() / words.len() as f32
    };
    OcrPageResult {
        page_index,
        language: language.to_string(),
        full_text: lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        lines,
        mean_confidence,
    }
}

/// Recognises one page image with Tesseract.
pub fn recognize(
    program: &Path,
    image: &[u8],
    language: &str,
    page_index: usize,
) -> Result<OcrPageResult, String> {
    if !valid_language(language) {
        return Err("Choose Tesseract languages such as eng, deu or eng+deu.".into());
    }
    let (width, height) = png_size(image)?;
    let directory =
        tempfile::tempdir().map_err(|_| "A private folder for OCR could not be made.")?;
    let input = directory.path().join("page.png");
    // The folder is readable only by this user, so the page image stays private.
    std::fs::write(&input, image).map_err(|_| "The page image could not be written for OCR.")?;
    let output = run(
        program,
        &[
            input.as_os_str(),
            "stdout".as_ref(),
            "-l".as_ref(),
            language.as_ref(),
            "--psm".as_ref(),
            "3".as_ref(),
            "tsv".as_ref(),
        ],
        directory.path(),
    )?;
    let tsv = String::from_utf8_lossy(&output);
    Ok(parse_tsv(&tsv, width, height, page_index, language))
}

/// The languages the installed Tesseract has data for.
pub fn languages(program: &Path) -> Result<Vec<String>, String> {
    let directory =
        tempfile::tempdir().map_err(|_| "A private folder for OCR could not be made.")?;
    let output = run(program, &["--list-langs".as_ref()], directory.path())?;
    Ok(String::from_utf8_lossy(&output)
        .lines()
        .map(str::trim)
        .filter(|line| valid_language(line) && *line != "osd")
        .map(String::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_are_allow_listed() {
        for good in ["eng", "chi_sim", "eng+deu", "srp_latn"] {
            assert!(valid_language(good), "{good}");
        }
        for bad in [
            "",
            "en",
            "ENG",
            "eng;rm",
            "../eng",
            "eng+",
            "a+b+c+d+e+f",
            "eng --oem",
        ] {
            assert!(!valid_language(bad), "{bad}");
        }
    }

    #[test]
    fn tsv_words_become_lines_measured_from_the_bottom() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
                   1\t1\t0\t0\t0\t0\t0\t0\t200\t100\t-1\t\n\
                   5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t96.5\tHello\n\
                   5\t1\t1\t1\t1\t2\t50\t20\t40\t10\t80\tworld\n\
                   5\t1\t1\t1\t2\t1\t10\t60\t20\t10\t50\tBye\n\
                   5\t1\t1\t1\t2\t2\t40\t60\t20\t10\t-1\t \n";
        let result = parse_tsv(tsv, 200.0, 100.0, 3, "eng");
        assert_eq!(result.page_index, 3);
        assert_eq!(result.full_text, "Hello world\nBye");
        assert_eq!(result.lines.len(), 2);
        let hello = &result.lines[0].words[0];
        assert_eq!(hello.bbox, [0.05, 0.7, 0.15, 0.1]);
        assert!((hello.confidence - 0.965).abs() < 1e-6);
        let line = &result.lines[0];
        assert!((line.bbox[2] - 0.4).abs() < 1e-6);
        assert!((result.mean_confidence - (0.965 + 0.8 + 0.5) / 3.0).abs() < 1e-6);
    }

    /// A PNG header for an image of the given size; only the header is read before Tesseract.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 2, 0, 0, 0]);
        bytes
    }

    #[cfg(unix)]
    #[test]
    fn runs_the_program_with_fixed_arguments_and_an_empty_environment() {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        let script = folder.path().join("tesseract");
        let log = folder.path().join("args.txt");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nenv >> '{}'\nprintf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n5\\t1\\t1\\t1\\t1\\t1\\t0\\t0\\t10\\t10\\t90\\tOK\\n'\n",
                log.display(),
                log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let result = recognize(&script, &png(100, 50), "eng+deu", 2).unwrap();
        assert_eq!(result.full_text, "OK");
        let logged = std::fs::read_to_string(&log).unwrap();
        let args: Vec<&str> = logged.lines().take(7).collect();
        assert!(args[0].ends_with("page.png"));
        assert_eq!(&args[1..], ["stdout", "-l", "eng+deu", "--psm", "3", "tsv"]);
        assert!(!logged.contains("HOME="), "the environment is cleared");
        assert!(recognize(&script, &png(100, 50), "eng;rm -rf", 0).is_err());

        std::fs::write(&script, "#!/bin/sh\nexit 3\n").unwrap();
        assert!(recognize(&script, &png(100, 50), "eng", 0)
            .unwrap_err()
            .contains("could not read"));
    }

    /// Runs an installed Tesseract on the PNG named by `NAVPDF_OCR_PNG`, expecting the text in
    /// `NAVPDF_OCR_TEXT`. Ignored by default because CI does not install Tesseract.
    #[test]
    #[ignore]
    fn an_installed_tesseract_reads_a_page() {
        let image = std::fs::read(std::env::var("NAVPDF_OCR_PNG").unwrap()).unwrap();
        let expected = std::env::var("NAVPDF_OCR_TEXT").unwrap();
        let program = program("").unwrap();
        let result = recognize(&program, &image, "eng", 0).unwrap();
        assert!(result.full_text.contains(&expected), "{}", result.full_text);
        assert!(result.mean_confidence > 0.5);
        assert!(languages(&program).unwrap().contains(&"eng".to_string()));
    }

    #[test]
    fn a_relative_or_missing_program_is_refused() {
        assert!(program("tesseract").is_err());
        assert!(program("/no/such/tesseract").is_err());
    }
}
