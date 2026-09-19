import { accessSync, constants, lstatSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

/** Acceptance scripts operate only on disposable output and synthetic fixtures. */
export function artifactPath(value, allowedDirectories = ["output"]) {
  const resolved = path.resolve(workspace, value);
  const root = allowedDirectories
    .map((name) => path.join(workspace, name))
    .find((candidate) => {
      const relative = path.relative(candidate, resolved);
      return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
      );
    });
  if (!root)
    throw new Error("Acceptance paths must stay inside the repository artifact directories.");
  for (let current = resolved; current !== workspace; current = path.dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("Acceptance paths must not contain symbolic links.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return resolved;
}

/** Resolve installed acceptance tools without consulting a caller-controlled PATH. */
export function localTool(name) {
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error("Invalid acceptance tool name.");
  const directories = [
    "/usr/bin",
    "/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/homebrew/opt/nss/bin",
    "/usr/local/opt/nss/bin",
    path.join(homedir(), ".cargo", "bin"),
  ];
  for (const directory of directories) {
    const executable = path.join(directory, name);
    try {
      accessSync(executable, constants.X_OK);
      return executable;
    } catch {
      /* Try the next fixed installation directory. */
    }
  }
  throw new Error(`Required acceptance tool is missing: ${name}`);
}
