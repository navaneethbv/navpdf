import { useEffect, useRef } from "react";

export interface ContextMenuAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export function ContextMenu({
  x,
  y,
  actions,
  onAction,
  onClose,
}: Readonly<{
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onAction: (id: string) => void;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    first?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Selection actions"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={() => {
            onAction(action.id);
            onClose();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
