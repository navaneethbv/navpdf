import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../services/native";

type OpenRequest = { token: string; error: string | null };

/** Notifications are hints; the native queue owns requests until consumed. */
export function useNativeOpenRequests(
  ready: boolean,
  canOpen: () => boolean,
  open: (token: string) => Promise<void>,
  report: (error: unknown) => void,
) {
  useEffect(() => {
    if (!native || !ready) return;
    let disposed = false;
    let running = false;
    let requested = false;
    const isDisposed = (): boolean => disposed;
    const needsRefresh = (): boolean => requested;
    let unlisten: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const handleRequest = async (request: OpenRequest) => {
      if (request.error) {
        await invoke("dismiss_open_request", { token: request.token });
        report(request.error);
        return;
      }
      await open(request.token);
    };
    const drain = async () => {
      requested = true;
      if (running || disposed) return;
      clearTimeout(retry);
      retry = undefined;
      running = true;
      try {
        while (!isDisposed()) {
          requested = false;
          const requests = await invoke<OpenRequest[]>("pending_open_requests");
          if (isDisposed()) return;
          const request = requests[0];
          if (!request) {
            if (needsRefresh()) continue;
            return;
          }
          if (!canOpen()) {
            retry = setTimeout(() => void drain(), 250);
            return;
          }
          await handleRequest(request);
        }
      } catch (error) {
        if (!isDisposed()) report(error);
      } finally {
        running = false;
      }
    };
    // Subscribe before the snapshot, including requests that arrived during startup.
    void listen<{ error?: string }>("open-token", ({ payload }) => {
      if (payload.error) report(payload.error);
      void drain();
    })
      .then((stop) => {
        if (isDisposed()) stop();
        else {
          unlisten = stop;
          void drain();
        }
      })
      .catch(report);
    return () => {
      disposed = true;
      unlisten?.();
      clearTimeout(retry);
    };
  }, [ready, canOpen, open, report]);
}
