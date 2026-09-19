// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNativeOpenRequests } from "../../src/app/useNativeOpenRequests";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../src/services/native", () => ({ native: true }));
let requests: { token: string; error: string | null }[];
let notify: (event: { payload: { error?: string } }) => void;
const stop = vi.fn();
const report = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  requests = [{ token: "before-listener", error: null }];
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    notify = callback as typeof notify;
    return stop;
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "pending_open_requests") return [...requests];
    if (command === "dismiss_open_request")
      requests = requests.filter((r) => r.token !== (args as { token: string }).token);
  });
});
afterEach(() => vi.useRealTimers());
const flush = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
it("subscribes before draining a request delivered before renderer startup", async () => {
  const open = vi.fn(async () => {
    requests = [];
  });
  const ready = () => true;
  const { rerender, unmount } = renderHook(
    ({ available }) => useNativeOpenRequests(available, ready, open, report),
    { initialProps: { available: false } },
  );
  await flush();
  expect(invoke).not.toHaveBeenCalled();
  rerender({ available: true });
  await flush();
  expect(vi.mocked(listen).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(invoke).mock.invocationCallOrder[0],
  );
  expect(open).toHaveBeenCalledExactlyOnceWith("before-listener");
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});
it("retains requests while busy and serializes overlapping notifications", async () => {
  let ready = false;
  let finish!: () => void;
  const open = vi.fn(async (token: string) => {
    if (Object.is(token, "before-listener"))
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    requests = requests.filter((request) => !Object.is(request.token, token));
  });
  const { unmount } = renderHook(() => useNativeOpenRequests(true, () => ready, open, report));
  await flush();
  expect(open).not.toHaveBeenCalled();
  ready = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  requests.push({ token: "second", error: null });
  notify({ payload: {} });
  notify({ payload: {} });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await flush();
  expect(open.mock.calls).toEqual([["before-listener"], ["second"]]);
  expect(requests).toEqual([]);
  unmount();
});
it("delivers queued input errors and releases them without opening", async () => {
  requests = [{ token: "bad-batch", error: "Open one PDF at a time." }];
  const open = vi.fn();
  const { unmount } = renderHook(() => useNativeOpenRequests(true, () => true, open, report));
  await flush();
  expect(open).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith("Open one PDF at a time.");
  expect(requests).toEqual([]);
  unmount();
});
it("stops deferred requests after unmount and reports subscription failure", async () => {
  const open = vi.fn();
  const { unmount } = renderHook(() => useNativeOpenRequests(true, () => false, open, report));
  await flush();
  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(open).not.toHaveBeenCalled();
  vi.mocked(listen).mockRejectedValueOnce(new Error("listener unavailable"));
  renderHook(() => useNativeOpenRequests(true, () => true, open, report));
  await flush();
  expect(report).toHaveBeenCalledWith(new Error("listener unavailable"));
});
