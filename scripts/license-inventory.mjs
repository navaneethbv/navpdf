// Release license inventory for the macOS arm64 bundle.
// Usage: node scripts/license-inventory.mjs [output.json]
// Lists the Rust crates resolved for aarch64-apple-darwin and the production npm packages
// in package-lock.json, and flags licenses that need review before distribution.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { artifactPath, localTool } from "./local-paths.mjs";

const output = artifactPath(process.argv[2] ?? "output/release/licenses.json");
const TARGET = "aarch64-apple-darwin";
// Permissive licenses that only require keeping notices; anything else is listed for review.
const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "MIT-0",
  "Unicode-3.0",
  "Apache-2.0 WITH LLVM-exception",
]);

/**
 * True when an SPDX-like expression can be satisfied using only permissive licenses.
 * AND binds tighter than OR, parentheses group, and "/" is the legacy spelling of OR.
 */
function permissive(expression) {
  if (!expression) return false;
  const tokens =
    expression.replace(/\s*\/\s*/g, " OR ").match(/\(|\)|[^\s()]+(?:\s+WITH\s+[^\s()]+)?/g) ?? [];
  let position = 0;
  const primary = () => {
    if (tokens[position] === "(") {
      position++;
      const value = anyOf();
      position++; // closing parenthesis
      return value;
    }
    return PERMISSIVE.has(tokens[position++]);
  };
  const allOf = () => {
    let value = primary();
    while (tokens[position] === "AND") {
      position++;
      value = primary() && value;
    }
    return value;
  };
  const anyOf = () => {
    let value = allOf();
    while (tokens[position] === "OR") {
      position++;
      value = allOf() || value;
    }
    return value;
  };
  return anyOf() && position === tokens.length;
}

const cargo = spawnSync(
  localTool("cargo"),
  [
    "metadata",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--format-version",
    "1",
    "--locked",
    "--filter-platform",
    TARGET,
  ],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);
if (cargo.status !== 0) throw new Error(`cargo metadata failed: ${cargo.stderr}`);
const metadata = JSON.parse(cargo.stdout);
const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
const workspace = new Set(metadata.workspace_members);
const crates = metadata.packages
  .filter((pkg) => resolved.has(pkg.id) && !workspace.has(pkg.id))
  .map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? null,
    repository: pkg.repository ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const npm = Object.entries(lock.packages)
  .filter(([key, value]) => key && !value.dev)
  .map(([key, value]) => ({
    name: key.replace(/^.*node_modules\//, ""),
    version: value.version,
    license: value.license ?? null,
    optional: !!value.optional,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const review = [
  ...crates
    .filter((item) => !permissive(item.license))
    .map((item) => ({ ecosystem: "cargo", ...item })),
  ...npm.filter((item) => !permissive(item.license)).map((item) => ({ ecosystem: "npm", ...item })),
];
const count = (items) =>
  Object.entries(
    items.reduce(
      (totals, item) => ({
        ...totals,
        [item.license ?? "UNKNOWN"]: (totals[item.license ?? "UNKNOWN"] ?? 0) + 1,
      }),
      {},
    ),
  ).sort((a, b) => b[1] - a[1]);

const report = {
  target: TARGET,
  project: {
    cargoLicense: metadata.packages.find((pkg) => workspace.has(pkg.id))?.license ?? null,
    npmLicense: JSON.parse(readFileSync("package.json", "utf8")).license ?? null,
  },
  totals: { cargo: crates.length, npm: npm.length, review: review.length },
  licenses: { cargo: count(crates), npm: count(npm) },
  review,
  crates,
  npm,
};
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `${crates.length} crates and ${npm.length} npm packages; ${review.length} need license review; wrote ${output}`,
);
for (const item of review)
  console.log(
    `  review ${item.ecosystem} ${item.name} ${item.version}: ${item.license ?? "no license field"}`,
  );
console.log(
  `project license: cargo ${report.project.cargoLicense ?? "not declared"}, npm ${report.project.npmLicense ?? "not declared"}`,
);
