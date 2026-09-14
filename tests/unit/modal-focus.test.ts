// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { installModalFocus } from "../../src/components/ModalFocus";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function tab(shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(event);
  return event.defaultPrevented;
}

function modal() {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.innerHTML = `
    <button id="close">Close</button>
    <input id="field" />
    <button id="hidden-submit" type="submit" hidden tabindex="-1">Submit</button>
    <button id="disabled" disabled>Disabled</button>
    <button id="confirm">Confirm</button>`;
  return dialog;
}

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  document.body.innerHTML = "";
});

describe("modal focus", () => {
  it("moves focus into a modal, keeps Tab inside it and returns focus to the opener", async () => {
    const opener = document.createElement("button");
    const outside = document.createElement("button");
    document.body.append(opener, outside);
    opener.focus();
    uninstall = installModalFocus();

    const dialog = modal();
    document.body.append(dialog);
    await settle();
    expect(document.activeElement?.id).toBe("close");

    (dialog.querySelector("#confirm") as HTMLElement).focus();
    expect(tab()).toBe(true);
    expect(document.activeElement?.id).toBe("close");
    expect(tab(true)).toBe(true);
    expect(document.activeElement?.id).toBe("confirm");
    (dialog.querySelector("#field") as HTMLElement).focus();
    expect(tab()).toBe(false);

    outside.focus();
    expect(tab()).toBe(true);
    expect(document.activeElement?.id).toBe("close");

    dialog.remove();
    await settle();
    expect(document.activeElement).toBe(opener);
    outside.focus();
    expect(tab()).toBe(false);
  });

  it("focuses a modal without focusable content and stops listening when uninstalled", async () => {
    uninstall = installModalFocus();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    await settle();
    expect(document.activeElement).toBe(dialog);
    expect(tab()).toBe(true);

    uninstall();
    uninstall = undefined;
    expect(tab()).toBe(false);
  });
});
