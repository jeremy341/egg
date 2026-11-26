import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileDock } from "./mobile-dock";

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  refs: [] as Array<{ current: unknown }>,
  setOpen: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [true, hooks.setOpen],
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useRef: (current: unknown) => {
    const ref = { current };
    hooks.refs.push(ref);
    return ref;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/projects" }));
vi.mock("@/components/find-palette", () => ({ useFind: () => ({ open: vi.fn() }) }));
vi.mock("@/components/nav-list", () => ({
  DocsLink: () => null,
  NavList: () => null,
  NavListSkeleton: () => null,
  navItemClass: "",
  navItemIdle: "",
}));
vi.mock("@/components/server-switcher", () => ({ ServerSwitcher: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ IconTip: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));

let cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  hooks.effects = [];
  hooks.refs = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function openMenu() {
  const markup = renderToStaticMarkup(createElement(MobileDock));
  const page = {
    activeElement: null as unknown,
    querySelector: () => null,
    body: { style: { overflow: "" } },
  };
  function control({ tabIndex = 0, visible = true, disabled = false } = {}) {
    const element = {
      tabIndex,
      matches: (selector: string) => selector === ":disabled" && disabled,
      closest: () => null,
      getClientRects: () => ({ length: Number(visible) }),
      focus: () => { page.activeElement = element; },
    };
    return element;
  }
  const opener = control();
  const first = control();
  const last = control();
  const outside = control();
  const controls = [first, control({ tabIndex: -1 }), control({ visible: false }), last, control({ disabled: true })];
  const dialog = {
    querySelector: () => null,
    querySelectorAll: () => controls,
    contains: (element: (typeof controls)[number]) => controls.includes(element),
  };
  const windowTarget = Object.assign(new EventTarget(), {
    getComputedStyle: () => ({ visibility: "visible" }),
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", page);
  opener.focus();
  const [openerRef, , dialogRef, closeRef] = hooks.refs;
  openerRef.current = opener;
  dialogRef.current = dialog;
  if (closeRef) closeRef.current = first;
  cleanups = hooks.effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === "function");

  function press(key: string, shiftKey = false) {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key, shiftKey });
    windowTarget.dispatchEvent(event);
    return event;
  }

  return { markup, page, opener, first, last, outside, press };
}

describe("mobile navigation dialog", () => {
  it("renders and focuses the close button inside the dialog", () => {
    const { markup, page, first } = openMenu();
    expect(markup).toContain('aria-expanded="true" aria-controls="mobile-menu"');
    expect(markup.split('role="dialog"')[1]).toMatch(/<button\b[^>]*aria-label="Close menu"/);
    expect(page.activeElement).toBe(first);
  });

  it("wraps Tab and Shift+Tab at the visible, enabled boundaries", () => {
    const { page, first, last, press } = openMenu();
    last.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(page.activeElement).toBe(first);
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(page.activeElement).toBe(last);
  });

  it("returns stray focus to the first control on Tab", () => {
    const { page, outside, first, press } = openMenu();
    outside.focus();
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(page.activeElement).toBe(first);
  });

  it("closes on Escape and restores focus to the opener", () => {
    const { page, opener, last, press } = openMenu();
    last.focus();
    press("Escape");
    expect(hooks.setOpen).toHaveBeenCalledWith(false);
    expect(page.activeElement).toBe(opener);
  });
});
