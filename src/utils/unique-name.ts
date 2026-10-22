/**
 * Returns `nameFor(1)`, or the first later copy number whose name is free, and records the
 * result as used. Names are compared case-insensitively.
 */
export function uniqueName(nameFor: (copy: number) => string, used: Set<string>) {
  let copy = 1;
  let name = nameFor(copy);
  while (used.has(name.toLowerCase())) {
    copy++;
    name = nameFor(copy);
  }
  used.add(name.toLowerCase());
  return name;
}
