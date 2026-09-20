import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { artifactPath, localTool } from "../../scripts/local-paths.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

it("resolves disposable artifacts and rejects escapes and symbolic links", () => {
  expect(artifactPath("output/review/new.pdf")).toBe(path.resolve("output/review/new.pdf"));
  expect(() => artifactPath("output/../../personal.pdf")).toThrow(/artifact directories/);
  expect(() => artifactPath("src/app/App.tsx")).toThrow(/artifact directories/);
  mkdirSync("output", { recursive: true });
  const directory = mkdtempSync(path.resolve("output/path-test-"));
  directories.push(directory);
  symlinkSync(path.resolve("src"), path.join(directory, "escape"));
  expect(() => artifactPath(path.join(directory, "escape", "app", "App.tsx"))).toThrow(
    /symbolic links/,
  );
});

it("rejects paths and command syntax as executable names", () => {
  expect(() => localTool("../tool")).toThrow(/Invalid/);
  expect(() => localTool("tool; command")).toThrow(/Invalid/);
  expect(() => localTool("missing-navpdf-acceptance-tool")).toThrow(/missing/);
});
