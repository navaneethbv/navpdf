import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type Handlers = Partial<{
  [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void;
}>;

/**
 * Attaches native listeners to a drawing overlay, always calling the latest handlers. Overlays
 * are pointer surfaces with an accessible name and Escape to leave, not form controls.
 */
export function useOverlayEvents(ref: RefObject<HTMLElement | null>, handlers: Handlers) {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const names = Object.keys(latest.current) as (keyof HTMLElementEventMap)[];
    const listeners = names.map((name) => {
      const listener = (event: Event) => {
        const handler = latest.current[name] as ((event: Event) => void) | undefined;
        handler?.(event);
      };
      element.addEventListener(name, listener);
      return [name, listener] as const;
    });
    return () => {
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
    };
  }, [ref]);
}
