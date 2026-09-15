// Phase 10 acceptance for local certificate signatures (ADR 0009).
// Usage: node scripts/phase10-acceptance.mjs
// Creates synthetic identities with OpenSSL, signs synthetic PDFs through the engine CLI and
// validates every output independently with poppler pdfsig (NSS database, OCSP disabled) and
// OpenSSL CMS verification. The PKCS #12 password is random for each run, reaches OpenSSL through
// the environment and the CLI through standard input, and is never written to disk or the report.
// Private keys and PKCS #12 files are deleted when the run ends.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = "output/phase10";
const KEYS = path.join(OUT, "identities");
const NSS = path.join(OUT, "nss");
const CLI = "src-tauri/target/debug/examples/engine_cli";
const SOURCES = {
  reader: "tests/pdf-fixtures/reader-5.pdf",
  forms: "tests/pdf-fixtures/mixed-forms-annotations.pdf",
};

const results = [];
const outputs = {};

function check(name, passed, detail = "") {
  results.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(KEYS, { recursive: true });
mkdirSync(NSS, { recursive: true });

const secret = randomBytes(24).toString("base64url");
const env = { ...process.env, NAVPDF_ACCEPTANCE_P12: secret };
const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024, ...options });

function tool(command, args) {
  const result = run(command, args);
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

const key = (name) => path.join(KEYS, name);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function leaf(name, serial, keyArgs, validity) {
  tool("openssl", [
    "req",
    "-new",
    "-newkey",
    ...keyArgs,
    "-nodes",
    "-keyout",
    key(`${name}.key`),
    "-out",
    key(`${name}.csr`),
    "-subj",
    `/CN=Synthetic ${name} signer/O=NavPDF Acceptance`,
  ]);
  tool("openssl", [
    "x509",
    "-req",
    "-in",
    key(`${name}.csr`),
    "-CA",
    key("root.pem"),
    "-CAkey",
    key("root.key"),
    "-set_serial",
    String(serial),
    ...validity,
    "-extfile",
    key("leaf.ext"),
    "-out",
    key(`${name}.pem`),
  ]);
}

function pkcs12(name, source, extra = []) {
  tool("openssl", [
    "pkcs12",
    "-export",
    "-inkey",
    key(`${source}.key`),
    "-in",
    key(`${source}.pem`),
    "-certfile",
    key("root.pem"),
    "-name",
    name,
    ...extra,
    "-passout",
    "env:NAVPDF_ACCEPTANCE_P12",
    "-out",
    key(`${name}.p12`),
  ]);
}

function signPdf(label, source, identity, options = {}, password = secret) {
  const output = path.join(OUT, `${label}.pdf`);
  const request = path.join(OUT, `${label}.json`);
  writeFileSync(
    request,
    JSON.stringify({
      identity: key(`${identity}.p12`),
      reason: "",
      location: "",
      certification: "none",
      ...options,
    }),
  );
  const result = run(CLI, ["sign", source, output, request], { input: `${password}\n` });
  rmSync(request);
  if (result.status === 0) outputs[label] = sha256(output);
  return { output, status: result.status, stderr: result.stderr.trim() };
}

function navpdfReport(file) {
  const request = path.join(OUT, "verify.json");
  writeFileSync(request, "{}");
  const result = run(CLI, ["verify", file, "-", request]);
  rmSync(request);
  return result.status === 0 ? JSON.parse(result.stdout) : null;
}

function pdfsig(file) {
  const result = run("pdfsig", ["-nssdir", `sql:${NSS}`, "-no-ocsp", file]);
  return `${result.stdout}${result.stderr}`
    .split(/^Signature #\d+:$/m)
    .slice(1)
    .map((block) => ({
      valid: /Signature Validation: Signature is Valid\./.test(block),
      trusted: /Certificate Validation: Certificate is Trusted\./.test(block),
      total: /- Total document signed/.test(block),
      etsi: /Signature Type: ETSI\.CAdES\.detached/.test(block),
    }));
}

function derLength(value) {
  if (value[0] !== 0x30) return 0;
  if (value[1] < 0x80) return 2 + value[1];
  const count = value[1] & 0x7f;
  let length = 0;
  for (let index = 0; index < count; index++) length = length * 256 + value[2 + index];
  return 2 + count + length;
}

/** Verifies each CMS signature over its byte ranges with OpenSSL, independent of NavPDF. */
function opensslVerify(file) {
  const bytes = readFileSync(file);
  const text = bytes.toString("latin1");
  const cms = path.join(OUT, "signature.der");
  const content = path.join(OUT, "signed-ranges.bin");
  const outcomes = [];
  for (const match of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const [start, firstLength, secondStart, secondLength] = match.slice(1).map(Number);
    const value = Buffer.from(text.slice(firstLength + 1, secondStart - 1), "hex");
    writeFileSync(cms, value.subarray(0, derLength(value)));
    writeFileSync(
      content,
      Buffer.concat([
        bytes.subarray(start, start + firstLength),
        bytes.subarray(secondStart, secondStart + secondLength),
      ]),
    );
    const result = run("openssl", [
      "cms",
      "-verify",
      "-binary",
      "-inform",
      "DER",
      "-in",
      cms,
      "-content",
      content,
      // pdfsig independently verifies the synthetic root trust chain above.
      // OpenSSL is responsible here for CMS signature and byte-range integrity.
      "-noverify",
      "-out",
      "/dev/null",
    ]);
    outcomes.push(result.status === 0);
  }
  rmSync(cms, { force: true });
  rmSync(content, { force: true });
  return outcomes;
}

const pageCount = (file) => /Pages:\s+(\d+)/.exec(tool("pdfinfo", [file]))?.[1];
const pageText = (file) => tool("pdftotext", ["-layout", file, "-"]);

function examine(label, file, source, count, certification = null) {
  if (!existsSync(file)) {
    check(`${label}: signed output exists`, false);
    return;
  }
  const signed = readFileSync(file);
  const original = readFileSync(source);
  check(
    `${label}: earlier revision bytes are preserved`,
    signed.subarray(0, original.length).equals(original),
  );
  check(
    `${label}: page count and extracted text are unchanged`,
    pageCount(file) === pageCount(source) && pageText(file) === pageText(source),
  );
  const poppler = pdfsig(file);
  const newest = poppler.at(-1);
  check(
    `${label}: pdfsig finds ${count} signature(s)`,
    poppler.length === count,
    String(poppler.length),
  );
  check(
    `${label}: pdfsig reports every signature valid`,
    poppler.length > 0 && poppler.every((entry) => entry.valid),
  );
  check(
    `${label}: pdfsig reports ETSI.CAdES.detached covering the whole file`,
    newest?.etsi && newest.total,
  );
  check(`${label}: pdfsig trusts the synthetic root certificate`, newest?.trusted);
  const cms = opensslVerify(file);
  check(
    `${label}: OpenSSL verifies every CMS signature`,
    cms.length === count && cms.every(Boolean),
  );
  const local = navpdfReport(file);
  check(
    `${label}: NavPDF verifier agrees`,
    local?.length === count &&
      local.every((entry) => entry.status === "valid") &&
      local.at(-1).coversWholeDocument &&
      (certification === null || local[0].certification === certification),
  );
}

try {
  writeFileSync(
    key("leaf.ext"),
    "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation\nextendedKeyUsage=emailProtection\n",
  );
  tool("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-keyout",
    key("root.key"),
    "-out",
    key("root.pem"),
    "-days",
    "30",
    "-subj",
    "/CN=NavPDF Synthetic Root/O=NavPDF Acceptance",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  leaf("rsa", 4097, ["rsa:2048"], ["-days", "30"]);
  leaf("ec", 4098, ["ec", "-pkeyopt", "ec_paramgen_curve:P-256"], ["-days", "30"]);
  pkcs12("rsa", "rsa");
  pkcs12("ec", "ec");
  pkcs12("legacy", "rsa", [
    "-keypbe",
    "PBE-SHA1-3DES",
    "-certpbe",
    "PBE-SHA1-3DES",
    "-macalg",
    "sha1",
  ]);
  let expired = true;
  try {
    leaf("expired", 4099, ["rsa:2048"], ["-days", "0"]);
    pkcs12("expired", "expired");
  } catch (error) {
    expired = false;
    check("expired synthetic certificate created", false, error.message.split("\n")[0]);
  }
  tool("certutil", ["-N", "-d", `sql:${NSS}`, "--empty-password"]);
  tool("certutil", [
    "-A",
    "-d",
    `sql:${NSS}`,
    "-n",
    "NavPDF Synthetic Root",
    "-t",
    "CT,C,C",
    "-i",
    key("root.pem"),
  ]);
  tool("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--example", "engine_cli"]);
  for (const source of Object.values(SOURCES))
    copyFileSync(source, path.join(OUT, path.basename(source)));

  const rsa = signPdf("rsa-approval", SOURCES.reader, "rsa", {
    reason: "Synthetic approval",
    location: "Acceptance lab",
  });
  check("RSA identity signs reader-5.pdf", rsa.status === 0, rsa.stderr);
  examine("rsa-approval", rsa.output, SOURCES.reader, 1);

  const ec = signPdf("p256-approval", SOURCES.reader, "ec");
  check("P-256 identity signs reader-5.pdf", ec.status === 0, ec.stderr);
  examine("p256-approval", ec.output, SOURCES.reader, 1);

  const legacy = signPdf("legacy-p12-approval", SOURCES.reader, "legacy");
  check("3DES-encrypted PKCS #12 identity signs reader-5.pdf", legacy.status === 0, legacy.stderr);
  examine("legacy-p12-approval", legacy.output, SOURCES.reader, 1);

  const certified = signPdf("forms-certified", SOURCES.forms, "rsa", {
    certification: "formFilling",
  });
  check("RSA identity certifies the forms fixture", certified.status === 0, certified.stderr);
  examine("forms-certified", certified.output, SOURCES.forms, 1, 2);

  const countersigned = signPdf("forms-countersigned", certified.output, "ec");
  check(
    "P-256 identity countersigns the certified copy",
    countersigned.status === 0,
    countersigned.stderr,
  );
  examine("forms-countersigned", countersigned.output, certified.output, 2, 2);
  const layered = pdfsig(countersigned.output);
  check(
    "the first signature no longer covers the countersigned file",
    layered.length === 2 && !layered[0].total,
  );

  const wrong = signPdf("wrong-password", SOURCES.reader, "rsa", {}, "not-the-synthetic-secret");
  check(
    "a wrong PKCS #12 password is refused without output",
    wrong.status !== 0 && !existsSync(wrong.output),
  );
  if (expired) {
    const late = signPdf("expired", SOURCES.reader, "expired");
    check(
      "an expired certificate is refused",
      late.status !== 0 && /expired/.test(late.stderr),
      late.stderr,
    );
  }
  const recertify = signPdf("recertify", rsa.output, "rsa", { certification: "noChanges" });
  check(
    "certifying an already signed file is refused",
    recertify.status !== 0 && /first signature/.test(recertify.stderr),
  );
  const locked = signPdf("no-changes", SOURCES.reader, "rsa", { certification: "noChanges" });
  const afterLock = signPdf("after-no-changes", locked.output, "ec");
  check(
    "a no-changes certification blocks further signatures",
    locked.status === 0 && afterLock.status !== 0 && /does not allow/.test(afterLock.stderr),
  );

  const tamperedFile = path.join(OUT, "tampered.pdf");
  const tampered = Buffer.from(readFileSync(rsa.output));
  tampered[7] = tampered[7] === 0x37 ? 0x36 : 0x37;
  writeFileSync(tamperedFile, tampered);
  check(
    "pdfsig rejects a byte changed inside the signed range",
    pdfsig(tamperedFile).every((entry) => !entry.valid),
  );
  check(
    "OpenSSL rejects the tampered ranges",
    opensslVerify(tamperedFile).every((passed) => !passed),
  );
  check(
    "NavPDF reports the tampered copy as changed",
    navpdfReport(tamperedFile)?.[0]?.status === "modified",
  );

  const appendedFile = path.join(OUT, "appended.pdf");
  writeFileSync(
    appendedFile,
    Buffer.concat([readFileSync(rsa.output), Buffer.from("\n% synthetic later change\n")]),
  );
  const appended = pdfsig(appendedFile);
  check(
    "pdfsig keeps an appended copy valid but not totally signed",
    appended[0]?.valid && !appended[0].total,
  );
  const appendedLocal = navpdfReport(appendedFile)?.[0];
  check(
    "NavPDF reports the appended copy as changed after signing",
    appendedLocal?.status === "valid" && appendedLocal.coversWholeDocument === false,
  );
} finally {
  for (const name of ["root", "rsa", "ec", "expired"]) {
    rmSync(key(`${name}.key`), { force: true });
    rmSync(key(`${name}.csr`), { force: true });
  }
  for (const name of ["rsa", "ec", "legacy", "expired"])
    rmSync(key(`${name}.p12`), { force: true });
  rmSync(NSS, { recursive: true, force: true });
}

const passed = results.filter((result) => result.passed).length;
writeFileSync(
  path.join(OUT, "report.json"),
  `${JSON.stringify(
    {
      tools: {
        pdfsig: run("pdfsig", ["-v"]).stderr.split("\n")[0],
        openssl: run("openssl", ["version"]).stdout.trim(),
      },
      outputs,
      passed,
      total: results.length,
      checks: results,
    },
    null,
    2,
  )}\n`,
);
console.log(`${passed} of ${results.length} checks passed; wrote ${OUT}/report.json`);
process.exitCode = passed === results.length ? 0 : 1;
