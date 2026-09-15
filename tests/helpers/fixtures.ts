import { existsSync } from "node:fs";
import { resolve } from "node:path";

const fixtureDirectory = resolve("tests/pdf-fixtures");

export function requireFixture(name: string): string {
  const path = resolve(fixtureDirectory, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture ${name} is missing. Run \`npm run fixtures\` first.`);
  }
  return path;
}
