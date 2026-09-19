// Phase 7 acceptance: builds the synthetic canary corpus, runs the native engine through
// `engine_cli`, and checks every output with consumers that do not share the engine's code:
// poppler utilities, a raw zlib scan of every stream and pixel sampling of rendered pages.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants, inflateSync } from "node:zlib";
import path from "node:path";
import sharp from "sharp";
import { CANARIES, createCorpus } from "./create-redaction-corpus.mjs";

const root = path.resolve("output/phase7");
const results = [];

function record(scenario, check, passed, detail = "") {
  results.push({ scenario, check, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${scenario}: ${check}${detail ? ` (${detail})` : ""}`);
}

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

const engineBinary = path.resolve("src-tauri/target/debug/examples/engine_cli");

async function engine(operation, input, output, request) {
  const requestPath = `${output}.request.json`;
  await writeFile(requestPath, JSON.stringify(request));
  const result = run(engineBinary, [operation, input, output, requestPath]);
  await rm(requestPath, { force: true });
  return {
    ok: result.status === 0,
    report: result.status === 0 ? JSON.parse(result.stdout.trim().split("\n").pop()) : null,
    error: result.stderr.trim().split("\n").pop() ?? "",
  };
}

/** Every stream body, inflated when possible, plus the raw file bytes. */
function contentChunks(bytes) {
  const chunks = [bytes];
  const text = bytes.toString("latin1");
  // `endstream` also ends with "stream", so only keywords not preceded by "end" start a body.
  const pattern = /(?<!end)stream\r?\n/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    let stop = end;
    while (stop > start && (bytes[stop - 1] === 0x0a || bytes[stop - 1] === 0x0d)) stop--;
    try {
      chunks.push(
        inflateSync(bytes.subarray(start, stop), { finishFlush: constants.Z_SYNC_FLUSH }),
      );
    } catch {
      // Not Flate data (for example JPEG); the raw bytes are already included.
    }
    pattern.lastIndex = end;
  }
  return chunks;
}

/** Decoded hex strings, so UTF-16 text such as form values is scanned as characters. */
function decodedHexStrings(chunk) {
  const decoded = [];
  for (const match of chunk.toString("latin1").matchAll(/<([0-9A-Fa-f\s]{4,})>/g)) {
    const hex = match[1].replace(/\s+/g, "");
    const bytes = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
    decoded.push(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
      decoded.push(Buffer.from(bytes.subarray(2)).swap16());
  }
  return decoded;
}

function containsTerm(chunks, term) {
  const lower = term.toLowerCase();
  const utf16 = Buffer.from(term, "utf16le").swap16();
  const expanded = chunks.flatMap((chunk) => [chunk, ...decodedHexStrings(chunk)]);
  return expanded.some(
    (chunk) =>
      chunk.toString("latin1").toLowerCase().includes(lower) ||
      chunk.toString("utf16le").toLowerCase().includes(lower) ||
      chunk.includes(utf16),
  );
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function renderPage(file, page, dpi, password) {
  const prefix = path.join(root, `render-${path.basename(file, ".pdf")}-${page}-${dpi}`);
  const args = ["-r", String(dpi), "-f", String(page), "-l", String(page), "-png", "-singlefile"];
  if (password) args.push("-upw", password);
  const result = run("pdftoppm", [...args, file, prefix]);
  if (result.status !== 0) throw new Error(result.stderr);
  return `${prefix}.png`;
}

async function regionMean(png, rect, dpi, pageHeight = 792) {
  const scale = dpi / 72;
  const left = Math.round(rect[0] * scale) + 2;
  const top = Math.round((pageHeight - rect[3]) * scale) + 2;
  const width = Math.max(1, Math.round((rect[2] - rect[0]) * scale) - 4);
  const height = Math.max(1, Math.round((rect[3] - rect[1]) * scale) - 4);
  const { data, info } = await sharp(png)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let brightest = 0;
  for (let i = 0; i < info.width * info.height * info.channels; i++)
    brightest = Math.max(brightest, data[i]);
  return brightest;
}

async function redactionAcceptance(corpus) {
  const scenario = "redaction";
  const output = path.join(root, "redaction-output.pdf");
  const result = await engine("redact", corpus.files.redaction, output, {
    regions: corpus.regions,
    terms: corpus.terms,
    options: {
      removeMetadata: true,
      removeAttachments: true,
      removeScripts: true,
      removeComments: false,
      removeBookmarks: true,
      removeHiddenContent: true,
    },
    acknowledgeSignatures: false,
  });
  record(
    scenario,
    "engine applied and self-audit passed",
    result.ok && result.report.audit.passed,
    result.ok ? JSON.stringify(result.report.audit) : result.error,
  );
  if (!result.ok) return;
  const source = await readFile(corpus.files.redaction);
  const sourceChunks = contentChunks(source);
  const undetected = Object.values(CANARIES).filter(
    (term) => term !== CANARIES.image && !containsTerm(sourceChunks, term),
  );
  record(
    scenario,
    "source still holds every canary before redaction",
    undetected.length === 0,
    undetected.length ? `scanner did not find ${undetected.join(", ")}` : "",
  );
  const bytes = await readFile(output);
  const chunks = contentChunks(bytes);
  for (const term of corpus.terms) {
    record(scenario, `raw and inflated streams exclude ${term}`, !containsTerm(chunks, term));
  }
  const allText = run("pdftotext", ["-layout", output, "-"]).stdout;
  const pageOne = run("pdftotext", ["-f", "1", "-l", "1", "-layout", output, "-"]).stdout;
  const pageTwo = run("pdftotext", ["-f", "2", "-l", "2", "-layout", output, "-"]).stdout;
  record(
    scenario,
    "pdftotext finds no audited canary",
    corpus.terms.every((term) => !allText.includes(term)),
  );
  record(
    scenario,
    "unmarked text survives on page 1",
    pageOne.includes("Public heading stays visible") && pageOne.includes("Client:"),
  );
  record(
    scenario,
    "shared form is removed on page 1 only",
    !pageOne.includes(CANARIES.shared) && pageTwo.includes(CANARIES.shared),
  );
  const info = run("pdfinfo", ["-meta", output]);
  record(
    scenario,
    "pdfinfo shows no metadata canary",
    info.status === 0 &&
      !info.stdout.includes(CANARIES.meta) &&
      !info.stdout.includes(CANARIES.xmp),
    info.stderr.trim(),
  );
  const attachments = run("pdfdetach", ["-list", output]).stdout;
  record(
    scenario,
    "pdfdetach lists no embedded files",
    /0 embedded files/.test(attachments),
    attachments.trim(),
  );
  const pages = run("pdfinfo", [output]).stdout;
  record(scenario, "page count preserved", /Pages:\s+2/.test(pages));

  const dpi = 100;
  const rendered = await renderPage(output, 1, dpi);
  for (const [index, region] of corpus.regions.entries()) {
    const brightest = await regionMean(rendered, region.rect, dpi);
    record(
      scenario,
      `rendered region ${index + 1} is black`,
      brightest <= 40,
      `brightest channel ${brightest}`,
    );
  }
  const imageDirectory = path.join(root, "redaction-images");
  await rm(imageDirectory, { recursive: true, force: true });
  await mkdir(imageDirectory, { recursive: true });
  const listing = run("pdfimages", ["-list", "-f", "1", "-l", "1", output])
    .stdout.split("\n")
    .slice(2)
    .filter(Boolean);
  run("pdfimages", ["-png", "-f", "1", "-l", "1", output, path.join(imageDirectory, "img")]);
  const files = (await readdir(imageDirectory)).sort();
  const colorImages = listing
    .map((line, index) => ({ type: line.trim().split(/\s+/)[2], file: files[index] }))
    .filter((entry) => entry.type === "image");
  let darkest = 0;
  for (const entry of colorImages) {
    const stats = await sharp(path.join(imageDirectory, entry.file)).stats();
    darkest = Math.max(darkest, ...stats.channels.slice(0, 3).map((channel) => channel.max));
  }
  record(
    scenario,
    "extracted image samples are blackened, not only covered",
    colorImages.length > 0 && darkest <= 48,
    `${colorImages.length} image(s), brightest sample ${darkest}`,
  );
  record(scenario, "output identity", true, `${bytes.length} bytes sha256 ${sha256(bytes)}`);
}

async function protectionAcceptance(corpus) {
  const scenario = "protection";
  const userPassword = `pass-${randomBytes(12).toString("hex")}`;
  const ownerPassword = `owner-${randomBytes(12).toString("hex")}`;
  const output = path.join(root, "protected-output.pdf");
  const permissions = {
    print: true,
    printHighQuality: false,
    copy: false,
    modify: false,
    annotate: false,
    fillForms: true,
    assemble: false,
    accessibility: true,
  };
  const result = await engine("protect", corpus.files.protection, output, {
    userPassword: userPassword,
    ownerPassword: ownerPassword,
    permissions,
  });
  record(scenario, "engine protected and validated the copy", result.ok, result.error);
  if (!result.ok) return;
  const bytes = await readFile(output);
  record(
    scenario,
    "plaintext marker absent from encrypted bytes",
    !containsTerm(contentChunks(bytes), "PROTECT-PAGE-1"),
  );
  const locked = run("pdfinfo", [output]);
  record(
    scenario,
    "pdfinfo refuses to open without a password",
    locked.status !== 0,
    locked.stderr.trim(),
  );
  const wrong = run("pdfinfo", ["-upw", "wrong-password", output]);
  record(scenario, "pdfinfo rejects a wrong password", wrong.status !== 0, wrong.stderr.trim());
  const opened = run("pdfinfo", ["-upw", userPassword, output]);
  record(
    scenario,
    "pdfinfo opens with the user password as AES-256",
    opened.status === 0 &&
      /Encrypted:\s+yes/.test(opened.stdout) &&
      /AES-256/.test(opened.stdout) &&
      /Pages:\s+3/.test(opened.stdout),
    opened.stdout.split("\n").find((line) => line.startsWith("Encrypted")),
  );
  const owner = run("pdfinfo", ["-opw", ownerPassword, output]);
  record(
    scenario,
    "pdfinfo opens with the owner password",
    owner.status === 0 && /Pages:\s+3/.test(owner.stdout),
  );
  // Permission flags are advisory; each reader decides whether to enforce them.
  record(
    scenario,
    "pdfinfo reports the restricted permission flags",
    /copy:no/.test(opened.stdout) &&
      /change:no/.test(opened.stdout) &&
      /print:yes/.test(opened.stdout),
  );
  const userText = run("pdftotext", ["-upw", userPassword, output, "-"]);
  record(
    scenario,
    "informational: poppler text extraction with the open password",
    true,
    userText.stdout.includes("PROTECT-PAGE-3")
      ? "poppler extracts text despite copy:no (advisory flag not enforced by this reader)"
      : "poppler refused extraction",
  );
  const ownerText = run("pdftotext", ["-opw", ownerPassword, output, "-"]).stdout;
  record(
    scenario,
    "pdftotext reads text with the owner password",
    ownerText.includes("PROTECT-PAGE-3"),
  );
  const refused = await engine("unlock", output, path.join(root, "unlocked-refused.pdf"), {
    password: userPassword,
  });
  record(
    scenario,
    "user password cannot remove restrictions",
    !refused.ok && /owner/.test(refused.error),
    refused.error,
  );
  const unlockedPath = path.join(root, "unlocked-output.pdf");
  const unlocked = await engine("unlock", output, unlockedPath, {
    password: ownerPassword,
  });
  const plain = unlocked.ok ? run("pdftotext", [unlockedPath, "-"]).stdout : "";
  record(
    scenario,
    "owner password unlocks to readable plaintext",
    unlocked.ok && plain.includes("PROTECT-PAGE-2"),
    unlocked.error,
  );
  record(scenario, "output identity", true, `${bytes.length} bytes sha256 ${sha256(bytes)}`);
}

async function compressionAcceptance(corpus) {
  for (const [scenario, input, preset, tolerance] of [
    ["compression balanced", corpus.files.compression, "balanced", 40],
    ["compression lossless", corpus.files.lossless, "lossless", 0],
    [
      "compression lossless compact input",
      path.resolve("tests/pdf-fixtures/reader-100.pdf"),
      "lossless",
      0,
    ],
  ]) {
    const output = path.join(root, `compressed-${preset}.pdf`);
    const result = await engine("compress", input, output, { preset });
    if (!result.ok) {
      record(scenario, "engine completed", false, result.error);
      continue;
    }
    const { report } = result;
    const before = (await readFile(input)).length;
    record(
      scenario,
      "reported input size matches the file",
      report.beforeBytes === before,
      `${report.beforeBytes} vs ${before}`,
    );
    if (!report.useful) {
      record(scenario, "no useful reduction keeps the original", true, report.message);
      continue;
    }
    const after = (await readFile(output)).length;
    record(
      scenario,
      "reported output size matches the file",
      report.afterBytes === after,
      `${before} -> ${after} bytes (${((1 - after / before) * 100).toFixed(1)}% smaller)`,
    );
    record(
      scenario,
      "engine fidelity checks passed",
      report.checks.every((check) => check.passed),
    );
    const pages = Number(/Pages:\s+(\d+)/.exec(run("pdfinfo", [input]).stdout)?.[1] ?? 0);
    const textBefore = run("pdftotext", ["-layout", input, "-"]).stdout;
    const textAfter = run("pdftotext", ["-layout", output, "-"]).stdout;
    record(scenario, "pdftotext output identical", textBefore === textAfter);
    const fontsBefore = run("pdffonts", [input])
      .stdout.split("\n")
      .slice(2)
      .map((line) => line.split(/\s+/)[0])
      .sort()
      .join();
    const fontsAfter = run("pdffonts", [output])
      .stdout.split("\n")
      .slice(2)
      .map((line) => line.split(/\s+/)[0])
      .sort()
      .join();
    record(scenario, "pdffonts lists the same fonts", fontsBefore === fontsAfter);
    for (const page of [1, Math.max(1, pages)]) {
      const a = await sharp(await renderPage(input, page, 50))
        .raw()
        .toBuffer();
      const b = await sharp(await renderPage(output, page, 50))
        .raw()
        .toBuffer();
      let total = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) total += Math.abs(a[i] - b[i]);
      const mean = total / Math.max(1, Math.min(a.length, b.length));
      record(
        scenario,
        `page ${page} renders within tolerance`,
        a.length === b.length && mean <= Math.max(tolerance / 10, 0.5),
        `mean absolute sample difference ${mean.toFixed(3)}`,
      );
    }
  }
}

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const tool of ["pdftotext", "pdfinfo", "pdfdetach", "pdfimages", "pdftoppm", "pdffonts"]) {
  if (run("which", [tool]).status !== 0) {
    console.error(
      `Missing independent consumer: ${tool}. Install poppler-utils; acceptance cannot pass without it.`,
    );
    process.exit(2);
  }
}
const build = run("cargo", [
  "build",
  "--quiet",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--example",
  "engine_cli",
]);
if (build.status !== 0) {
  console.error(`The engine_cli example did not build:\n${build.stderr}`);
  process.exit(2);
}
const corpus = await createCorpus(path.join(root, "corpus"));
await redactionAcceptance(corpus);
await protectionAcceptance(corpus);
await compressionAcceptance(corpus);
await writeFile(path.join(root, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((result) => !result.passed);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed. Report: output/phase7/report.json`,
);
process.exit(failed.length ? 1 : 0);
