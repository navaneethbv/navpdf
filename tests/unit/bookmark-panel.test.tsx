// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookmarkPanel } from "../../src/features/viewer/BookmarkPanel";
import type { ViewerController } from "../../src/features/viewer/controller";

afterEach(cleanup);

it("asks before following a bookmark that opens a web address", () => {
  const requestExternalLink = vi.fn();
  const goToDestination = vi.fn(async () => {});
  const controller = { requestExternalLink, links: { goToDestination } };
  render(
    <BookmarkPanel
      bookmarks={[
        { title: "Chapter", destination: ["ref"], children: [] },
        { title: "Publisher", destination: null, url: "https://example.com/", children: [] },
      ]}
      controller={controller as unknown as ViewerController}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Publisher" }));
  expect(requestExternalLink).toHaveBeenCalledWith("https://example.com/");
  expect(goToDestination).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Chapter" }));
  expect(goToDestination).toHaveBeenCalledWith(["ref"]);
});
