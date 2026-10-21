// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/services/native", async (original) => ({
  ...(await original<typeof import("../../src/services/native")>()),
  native: true,
}));
vi.mock("../../src/services/engine", async (original) => ({
  ...(await original<typeof import("../../src/services/engine")>()),
  findCoverUps: vi.fn(),
  saveProtectedCopy: vi.fn(),
}));

import { passwordStrength } from "../../src/features/protect/password-strength";
import { ProtectDialog, validateProtection } from "../../src/features/protect/ProtectDialog";
import {
  CODE_SETS,
  RedactionAppearance,
  WholePagesMarker,
  hexToRgb,
} from "../../src/features/redact/RedactionAppearance";
import { CoverUpDialog } from "../../src/features/redact/CoverUpDialog";
import { findCoverUps, saveProtectedCopy } from "../../src/services/engine";
import { useWorkspace } from "../../src/stores/workspace";

const ALL = {
  print: true,
  printHighQuality: true,
  copy: true,
  accessibility: true,
  modify: true,
  annotate: true,
  fillForms: true,
  assemble: true,
};

beforeEach(() => {
  useWorkspace.getState().reset();
  vi.mocked(findCoverUps).mockReset();
  vi.mocked(saveProtectedCopy).mockReset();
});

it("rates passwords by length, variety and common patterns", () => {
  expect(passwordStrength("")).toMatchObject({ score: 0 });
  expect(passwordStrength("password123")).toMatchObject({ score: 0 });
  expect(passwordStrength("password123").advice).toContain("password");
  expect(passwordStrength("abcdefgh").score).toBeLessThanOrEqual(1);
  expect(passwordStrength("12345678901234567890").score).toBe(0);
  expect(passwordStrength("Tr7#kq").advice).toContain("12 characters");
  expect(passwordStrength("violet-anchor-27-Lantern-moss").score).toBe(4);
});

it("limits passwords for older encryption levels", () => {
  const long = "x".repeat(33);
  expect(validateProtection(long, long, "", "", ALL, "aes256")).toBeNull();
  expect(validateProtection(long, long, "", "", ALL, "rc4128")).toContain("32");
  expect(validateProtection("pässword", "pässword", "", "", ALL, "aes128")).toContain("ASCII");
});

it("sends the chosen encryption level and metadata option", async () => {
  vi.mocked(saveProtectedCopy).mockResolvedValue({
    name: "copy.pdf",
    size: 1,
    replacedSource: false,
  });
  useWorkspace
    .getState()
    .set({ document: { id: "d", name: "d.pdf", size: 1 }, info: { pages: 1 } as never });
  const controller = { pdf: { numPages: 1, saveDocument: vi.fn(async () => new Uint8Array([1])) } };
  render(<ProtectDialog controller={controller as never} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Encryption"), { target: { value: "aes128" } });
  fireEvent.click(screen.getByLabelText(/metadata unencrypted/));
  fireEvent.change(screen.getByLabelText("Open password"), { target: { value: "correct horse" } });
  expect(screen.getByRole("meter", { name: "Open password strength" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Confirm open password"), {
    target: { value: "correct horse" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save Protected Copy/ }));
  await vi.waitFor(() => expect(saveProtectedCopy).toHaveBeenCalled());
  expect(vi.mocked(saveProtectedCopy).mock.calls[0][3]).toMatchObject({
    encryption: "aes128",
    encryptMetadata: false,
  });
  expect(useWorkspace.getState().status).toContain("Protected copy saved");
});

it("chooses overlay codes and colours", () => {
  const onLabel = vi.fn();
  const onFill = vi.fn();
  render(<RedactionAppearance fill="#000000" onFill={onFill} label="" onLabel={onLabel} />);
  fireEvent.change(screen.getByLabelText("Redaction code"), { target: { value: "(b)(6)" } });
  expect(onLabel).toHaveBeenCalledWith("(b)(6)");
  fireEvent.change(screen.getByLabelText("Redaction code set"), {
    target: { value: "US Privacy Act (5 U.S.C. 552a)" },
  });
  expect(screen.getByRole("option", { name: "(k)(5)" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Redaction fill colour"), {
    target: { value: "#336699" },
  });
  expect(onFill).toHaveBeenCalledWith("#336699");
  expect(hexToRgb("#ff0000")).toEqual([1, 0, 0]);
  expect(hexToRgb("bad")).toEqual([0, 0, 0]);
  expect(CODE_SETS["US FOIA (5 U.S.C. 552)"]).toContain("(b)(7)(C)");
});

it("marks whole pages with their visible boxes", async () => {
  const onMark = vi.fn();
  const onError = vi.fn();
  const pdf = { numPages: 3, getPage: vi.fn(async () => ({ view: [0, 0, 612, 792] })) };
  render(<WholePagesMarker pdf={pdf} onMark={onMark} onError={onError} />);
  fireEvent.change(screen.getByLabelText("Mark whole pages"), { target: { value: "2-3" } });
  fireEvent.click(screen.getByRole("button", { name: "Mark Pages" }));
  await vi.waitFor(() => expect(onMark).toHaveBeenCalled());
  expect(onMark.mock.calls[0][0]).toEqual([
    { page: 2, rect: [0, 0, 612, 792] },
    { page: 3, rect: [0, 0, 612, 792] },
  ]);
  fireEvent.change(screen.getByLabelText("Mark whole pages"), { target: { value: "9-" } });
  fireEvent.click(screen.getByRole("button", { name: "Mark Pages" }));
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
});

it("lists fake redactions and sends them to Redact PDF", async () => {
  vi.mocked(findCoverUps).mockResolvedValue({
    pagesChecked: 2,
    truncated: false,
    findings: [
      {
        page: 2,
        kind: "coveredText",
        rect: [10, 20, 110, 40],
        characters: 12,
        sample: "Account 1234",
      },
      { page: 1, kind: "unappliedRedaction", rect: [0, 0, 5, 5], characters: 0, sample: "" },
    ],
  });
  const controller = {
    pdf: { saveDocument: vi.fn(async () => new Uint8Array([1])) },
    goTo: vi.fn(),
  };
  render(<CoverUpDialog controller={controller as never} onClose={() => {}} />);
  expect(await screen.findByText("Account 1234")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  expect(controller.goTo).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole("button", { name: "Mark All for Redaction" }));
  const state = useWorkspace.getState();
  expect(state.activeModal).toBe("redact");
  expect(state.redactionSelection[0].quads[0]).toEqual({ x1: 10, y1: 20, x2: 110, y2: 40 });
});

it("explains when nothing was found", async () => {
  vi.mocked(findCoverUps).mockResolvedValue({ pagesChecked: 1, truncated: false, findings: [] });
  const controller = { pdf: { saveDocument: vi.fn(async () => new Uint8Array([1])) } };
  render(<CoverUpDialog controller={controller as never} onClose={() => {}} />);
  expect(await screen.findByText(/No covered text/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Mark All for Redaction" })).toHaveProperty(
    "disabled",
    true,
  );
});
