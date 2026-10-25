// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  readTags: vi.fn(),
  findUntagged: vi.fn(),
  editTags: vi.fn(),
}));
vi.mock("../../src/services/engine", () => engine);

import { TagsDialog } from "../../src/features/document/TagsDialog";
import { useWorkspace } from "../../src/stores/workspace";
import type { TagNode } from "../../src/types/engine";

function tag(id: string, parent: string | null, extra: Partial<TagNode> = {}): TagNode {
  return {
    id,
    parent,
    depth: parent ? 1 : 0,
    role: "P",
    standardRole: null,
    title: "",
    alt: "",
    actualText: "",
    lang: "",
    page: 1,
    mcids: [],
    objects: 0,
    children: 0,
    ...extra,
  };
}

const TREE = {
  tagged: true,
  truncated: false,
  nodes: [
    tag("1 0", null, { role: "Document", children: 2, page: null }),
    tag("2 0", "1 0", { mcids: [0], page: 2 }),
    tag("3 0", "1 0", { role: "Figure", mcids: [1], page: 2 }),
  ],
};

function controller() {
  const page = {
    getTextContent: vi.fn(async () => ({
      items: [
        { type: "beginMarkedContentProps", id: "p4R_mc0" },
        { str: "Opening paragraph" },
        { type: "endMarkedContent" },
      ],
    })),
  };
  return {
    pdf: {
      saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
      getPage: vi.fn(async () => page),
    },
    goTo: vi.fn(),
    replaceWithBytes: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  act(() => useWorkspace.getState().reset());
});

describe("tags dialog", () => {
  it("tags an untagged document automatically and lists the new tags", async () => {
    engine.readTags
      .mockResolvedValueOnce({ tagged: false, truncated: false, nodes: [] })
      .mockResolvedValueOnce(TREE);
    engine.editTags.mockResolvedValue({
      bytes: new Uint8Array([1]),
      report: {
        message: "Added 2 tags. Review headings, figures and reading order in the Tags list.",
      },
    });
    const view = controller();
    render(<TagsDialog controller={view as never} onClose={() => {}} />);
    expect(await screen.findByText(/This document has no tags/)).toBeTruthy();
    fireEvent.click(screen.getByText("Tag Automatically"));
    await vi.waitFor(() =>
      expect(engine.editTags).toHaveBeenCalledWith(expect.any(Uint8Array), { action: "autotag" }),
    );
    expect(await screen.findByText("Figure")).toBeTruthy();
    expect(view.replaceWithBytes).toHaveBeenCalled();
    expect(useWorkspace.getState().status).toMatch(/Added 2 tags/);
  });

  it("edits, reorders and retires a selected tag, and finds untagged content", async () => {
    engine.readTags.mockResolvedValue(TREE);
    engine.editTags.mockResolvedValue({ bytes: new Uint8Array([1]), report: { message: "Done" } });
    engine.findUntagged.mockResolvedValue({
      tagged: true,
      truncated: false,
      pages: [{ page: 3, content: 2, annotations: 1, widgets: 0 }],
    });
    const view = controller();
    render(<TagsDialog controller={view as never} onClose={() => {}} />);
    const save = await screen.findByText("Save Tag Properties");
    expect((save.closest("button") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(
      screen
        .getAllByRole("button", { pressed: false })
        .find((button) => button.textContent?.startsWith("P"))!,
    );
    expect(view.goTo).toHaveBeenCalledWith(2);
    expect(await screen.findByText("Opening paragraph")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "H1" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en-GB" } });
    fireEvent.click(screen.getByText("Save Tag Properties"));
    await vi.waitFor(() =>
      expect(engine.editTags).toHaveBeenCalledWith(expect.any(Uint8Array), {
        action: "setProperties",
        id: "2 0",
        properties: { role: "H1", lang: "en-GB" },
      }),
    );

    fireEvent.click(await screen.findByText("Move Later"));
    await vi.waitFor(() =>
      expect(engine.editTags).toHaveBeenLastCalledWith(expect.any(Uint8Array), {
        action: "move",
        id: "2 0",
        offset: 1,
      }),
    );
    fireEvent.click(await screen.findByText("Mark as Artifact"));
    await vi.waitFor(() =>
      expect(engine.editTags).toHaveBeenLastCalledWith(expect.any(Uint8Array), {
        action: "markArtifact",
        id: "2 0",
      }),
    );

    fireEvent.click(screen.getByText("Find Untagged Content"));
    expect(await screen.findByText(/1 page\(s\) have untagged content/)).toBeTruthy();
    expect(screen.getByText(/2 drawing operation\(s\), 1 comment\(s\) or link\(s\)/)).toBeTruthy();
    fireEvent.click(screen.getByText("Page 3"));
    expect(view.goTo).toHaveBeenCalledWith(3);
  });

  it("collapses tags, filters them and reports engine failures", async () => {
    engine.readTags.mockResolvedValue(TREE);
    engine.editTags.mockRejectedValue(
      new Error("The tag is already at that end of its parent's children."),
    );
    const view = controller();
    render(<TagsDialog controller={view as never} onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText("Collapse Document"));
    expect(screen.queryByText("Figure")).toBeNull();
    fireEvent.change(screen.getByLabelText("Find tags by type or title"), {
      target: { value: "fig" },
    });
    fireEvent.click(await screen.findByText("Figure"));
    fireEvent.click(await screen.findByText("Move Earlier"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already at that end/);
  });
});
