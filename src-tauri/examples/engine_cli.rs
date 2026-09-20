//! Command-line access to the local PDF engine for acceptance scripts. Not bundled with NavPDF.
//!
//! Usage: `cargo run --example engine_cli -- <redact|protect|unlock|compress|sign|verify> <input> <output> <request.json>`
//!
//! `sign` reads the PKCS #12 password from standard input so it never appears in arguments.
//! `verify` prints the signature report and writes no output file.

use navpdf_lib::engine::{self, compress, protect, redact, sign};
use serde_json::{json, Value};
use std::io::{self, Write};
use std::process::ExitCode;
use std::sync::atomic::AtomicBool;
use std::time::SystemTime;
use std::{env, fs};

fn main() -> ExitCode {
    match run() {
        Ok(report) => {
            let mut out = io::stdout().lock();
            let _ = out.write_all(report.to_string().as_bytes());
            let _ = out.write_all(b"\n");
            ExitCode::SUCCESS
        }
        Err(error) => {
            let mut err = io::stderr().lock();
            let _ = err.write_all(error.as_bytes());
            let _ = err.write_all(b"\n");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<Value, String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let [operation, input, output, request] = args.as_slice() else {
        return Err(
            "usage: engine_cli <redact|protect|unlock|compress|sign|verify> <input> <output> <request.json>"
                .into(),
        );
    };
    let bytes = fs::read(input).map_err(|error| format!("Cannot read {input}: {error}"))?;
    let request: Value = serde_json::from_str(
        &fs::read_to_string(request).map_err(|error| format!("Cannot read {request}: {error}"))?,
    )
    .map_err(|error| format!("Invalid request JSON: {error}"))?;
    fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
        serde_json::from_value(value).map_err(|error| format!("Invalid request: {error}"))
    }
    let cancel = AtomicBool::new(false);
    match operation.as_str() {
        "redact" => {
            let request: redact::RedactionRequest = parse(request)?;
            let (result, report) = redact::apply(&bytes, &request, &cancel)?;
            fs::write(output, result).map_err(|error| format!("Cannot write {output}: {error}"))?;
            Ok(json!(report))
        }
        "protect" => {
            let request: protect::ProtectionRequest = parse(request)?;
            let pages = engine::load(&bytes)?.get_pages().len() as u32;
            let result = protect::protect(&bytes, &request, pages)?;
            fs::write(output, result).map_err(|error| format!("Cannot write {output}: {error}"))?;
            Ok(json!({ "pages": pages }))
        }
        "unlock" => {
            let password = request["password"]
                .as_str()
                .ok_or("A password is required.")?;
            let result = protect::unlock(&bytes, password)?;
            fs::write(output, result).map_err(|error| format!("Cannot write {output}: {error}"))?;
            Ok(json!({}))
        }
        "compress" => {
            let preset: compress::CompressionPreset = parse(request["preset"].clone())?;
            let (result, report) = compress::compress(&bytes, preset, &cancel)?;
            if let Some(result) = result {
                fs::write(output, result)
                    .map_err(|error| format!("Cannot write {output}: {error}"))?;
            }
            Ok(json!(report))
        }
        "sign" => {
            let path = request["identity"]
                .as_str()
                .ok_or("An identity path is required.")?
                .to_owned();
            let identity =
                fs::read(&path).map_err(|error| format!("Cannot read {path}: {error}"))?;
            let mut password = String::new();
            io::stdin()
                .read_line(&mut password)
                .map_err(|error| format!("Cannot read the password: {error}"))?;
            let identity = sign::load_identity(
                &identity,
                password.trim_end_matches(['\r', '\n']),
                SystemTime::now(),
            )?;
            let options: sign::SignRequest = parse(request)?;
            let pages = engine::load(&bytes)?.get_pages().len() as u32;
            let signed = sign::sign(&bytes, &identity, &options, SystemTime::now())?;
            sign::validate_signed(&signed, pages)?;
            fs::write(output, signed).map_err(|error| format!("Cannot write {output}: {error}"))?;
            Ok(json!({ "certificate": identity.summary, "pages": pages }))
        }
        "verify" => Ok(json!(sign::verify(&bytes)?)),
        other => Err(format!("Unknown operation {other}.")),
    }
}
