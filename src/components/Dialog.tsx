import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  children,
  onClose,
  priority,
  busy = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  priority?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    ref.current?.showModal();
    const d = ref.current;
    const focus = () => {
      const target = d?.querySelector<HTMLElement>("[autofocus]");
      target?.focus();
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focus);
    else queueMicrotask(focus);
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className={`app-dialog ${priority ? "priority-dialog" : ""} ${className}`.trim()}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog" disabled={busy}>
          <X size={18} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
