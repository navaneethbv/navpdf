import { spawnSync } from "node:child_process";

const tools = [
  ["pdftotext", ["-v"]],
  ["pdftoppm", ["-v"]],
  ["pdfimages", ["-v"]],
  ["pdfsig", ["-v"]],
  ["openssl", ["version"]],
  ["certutil", ["-H"]],
  ["textutil", ["-help"]],
  ["python3", ["--version"]],
];

function inspectTool(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return {
    command,
    available: result.error === undefined && result.status !== 127,
    version: output ?? "no version output",
  };
}

const results = tools.map(([command, args]) => inspectTool(command, args));
for (const result of results) {
  console.log(`${result.available ? "PASS" : "MISSING"} ${result.command}: ${result.version}`);
}

const missing = results.filter((result) => !result.available).map((result) => result.command);
if (missing.length > 0) {
  console.error(`Missing acceptance tools: ${missing.join(", ")}`);
  process.exitCode = 1;
}
