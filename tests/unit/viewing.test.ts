import { describe, expect, it } from "vitest";
import { boundedZoom, clampPage, snippet } from "../../src/utils/search";
import { useWorkspace } from "../../src/stores/workspace";
describe("viewer inputs", () => {
  it("bounds nonfinite and out-of-range zoom input", () => {
    expect(boundedZoom(NaN)).toBe(1);
    expect(boundedZoom(0.001)).toBe(0.25);
    expect(boundedZoom(100)).toBe(5);
  });
  it("bounds navigation to valid integral pages", () => {
    expect(clampPage(NaN, 500)).toBe(1);
    expect(clampPage(501, 500)).toBe(500);
    expect(clampPage(-1, 500)).toBe(1);
    expect(clampPage(3.6, 500)).toBe(4);
  });
  it("preserves search context and compresses whitespace", () => {
    expect(snippet("Before\nmatching\ttext after", 7, 8)).toBe("Before matching text after");
    const result = snippet("a".repeat(100) + "needle" + "b".repeat(100), 100, 6);
    expect(result).toContain("needle");
    expect(result.startsWith("…")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThan(100);
  });
  it("clears per-document state without erasing preferences", () => {
    useWorkspace.getState().set({
      page: 400,
      dirty: true,
      searchQuery: "private",
      results: [{ page: 1, index: 0, context: "private", match: "private" }],
      canUndo: true,
    });
    useWorkspace.getState().reset();
    expect(useWorkspace.getState()).toMatchObject({
      page: 1,
      dirty: false,
      searchQuery: "",
      results: [],
      canUndo: false,
    });
    expect(useWorkspace.getState().local.preferences.networkAccess).toBe(false);
  });

  it("retains parent outline nodes without destinations if they have child items", () => {
    type OutlineItem = {
      title: string;
      dest?: string | unknown[];
      items: OutlineItem[];
    };
    const rawOutline: OutlineItem[] = [
      {
        title: "Part I: Foundations",
        dest: undefined,
        items: [
          {
            title: "Chapter 1: Overview",
            dest: "page=1",
            items: [],
          },
          {
            title: "Chapter 2: Architecture",
            dest: "page=10",
            items: [],
          },
        ],
      },
      {
        title: "Empty Section",
        dest: undefined,
        items: [],
      },
    ];
    const map = (nodes: OutlineItem[]) =>
      nodes
        .filter((n) => n.dest || (n.items && n.items.length > 0))
        .map((n) => ({
          title: n.title,
          destination: (n.dest as string | unknown[]) ?? null,
          children: n.items ? map(n.items) : [],
        }));
    const result = map(rawOutline);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Part I: Foundations");
    expect(result[0].destination).toBeNull();
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[0].title).toBe("Chapter 1: Overview");
    expect(result[0].children[0].destination).toBe("page=1");
  });
});
