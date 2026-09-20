import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { installModalFocus } from "./ModalFocus";

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

export function FeatureDialog({
  title,
  children,
  onClose,
  busy = false,
  initialFocusRef,
  footer,
  className = "",
}: Readonly<{
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  footer?: ReactNode;
  className?: string;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const uninstall = installModalFocus();
    const focusTarget =
      initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    queueMicrotask(() => focusTarget?.focus());
    return () => {
      uninstall();
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [initialFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className={`dialog-backdrop ${className}`.trim()}
      open
      aria-modal="true"
      aria-label={title}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy) onClose();
        }
      }}
    >
      {children}
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </dialog>
  );
}
