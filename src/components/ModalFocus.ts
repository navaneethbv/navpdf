const MODAL = '[role="dialog"][aria-modal="true"], dialog[open][aria-modal="true"]';
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

function topModal(root: Document) {
  const modals = root.querySelectorAll<HTMLElement>(MODAL);
  return modals.length ? modals.item(modals.length - 1) : null;
}

function focusableIn(modal: HTMLElement) {
  return [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && !element.closest("[hidden]"),
  );
}

/**
 * Keeps keyboard focus inside the topmost modal dialog built from a `role="dialog"` element,
 * moves focus into it when it opens and returns focus to the opener when it closes.
 * Native `<dialog>` elements opened with `showModal()` already behave this way.
 */
export function installModalFocus(root: Document = document) {
  let current: HTMLElement | null = null;
  let opener: HTMLElement | null = null;

  const sync = () => {
    const modal = topModal(root);
    if (modal === current) return;
    if (modal) {
      if (!current && root.activeElement instanceof HTMLElement) opener = root.activeElement;
      current = modal;
      if (!modal.contains(root.activeElement)) {
        if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
        (focusableIn(modal)[0] ?? modal).focus();
      }
    } else {
      current = null;
      if (opener?.isConnected) opener.focus();
      opener = null;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const modal = topModal(root);
    if (!modal) return;
    const items = focusableIn(modal);
    const active = root.activeElement;
    if (items.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = items[0];
    const last = items.at(-1)!;
    if (!modal.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const observer = new MutationObserver(sync);
  observer.observe(root.body, { childList: true, subtree: true });
  root.addEventListener("keydown", onKeyDown, true);
  sync();
  return () => {
    observer.disconnect();
    root.removeEventListener("keydown", onKeyDown, true);
  };
}
