import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tabs } from "@base-ui/react/tabs";
import { AnalyticsTabs } from "./analytics-tabs";

const { callbacks, replace } = vi.hoisted(() => ({
  callbacks: { select: undefined as Tabs.Root.Props["onValueChange"] },
  replace: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useOptimistic: (value: string) => [value, vi.fn()],
  useTransition: () => [false, (action: () => void) => action()],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/example/analytics",
  useRouter: () => ({ replace }),
}));
vi.mock("@base-ui/react/tabs", async (importOriginal) => {
  const { Tabs } = await importOriginal<typeof import("@base-ui/react/tabs")>();
  return {
    Tabs: {
      ...Tabs,
      Root: ({ children, ...props }: Tabs.Root.Props) => {
        callbacks.select = props.onValueChange;
        return createElement(Tabs.Root, props, children);
      },
    },
  };
});

afterEach(() => {
  callbacks.select = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderTabs() {
  const props = { value: "overview" as const, children: "Analytics report" };
  return renderToStaticMarkup(createElement(AnalyticsTabs, props));
}

describe("analytics tabs", () => {
  it("keeps all five tabs in a row with a thin horizontal scrollbar", () => {
    const markup = renderTabs();
    expect(markup.match(/role="tab"/g)).toHaveLength(5);
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("scrollbar-width:thin");
    expect(markup).not.toContain("scrollbar-width:none");
  });

  it("scrolls the selected tab into view on keyboard activation", () => {
    const scrollIntoView = vi.fn();
    const setupTab = { scrollIntoView };
    class MouseEvent extends Event {
      detail = 0;
    }
    const event = new MouseEvent("click");
    renderTabs();
    vi.stubGlobal("MouseEvent", MouseEvent);
    vi.stubGlobal("document", {
      getElementById: (id: string) => id === "analytics-tab-setup" ? setupTab : null,
    });
    expect(callbacks.select).toBeDefined();
    callbacks.select?.("setup", {
      event,
      reason: "none",
      activationDirection: "none",
      cancel: vi.fn(),
      allowPropagation: vi.fn(),
      isCanceled: false,
      isPropagationAllowed: false,
      trigger: undefined,
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    expect(replace).toHaveBeenCalledWith("/projects/example/analytics?tab=setup", { scroll: false });
  });
});
