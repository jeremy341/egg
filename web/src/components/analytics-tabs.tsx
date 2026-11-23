"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "@base-ui/react/tabs";
import { ANALYTICS_TABS, parseTab, type AnalyticsTab } from "@/lib/analytics-tabs";

const PANEL_ID = "analytics-panel";

/**
 * The tab bar of the analytics page. The selected tab is the `?tab=` in the
 * address, so a tab can be linked and reloaded. The server sends only the
 * selected tab's content as `children`; choosing another tab asks for it.
 * Arrow keys move between tabs, Enter or Space selects.
 */
export function AnalyticsTabs({ value, children }: { value: AnalyticsTab; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(value);

  function select(next: string, { event }: Tabs.Root.ChangeEventDetails) {
    const tab = parseTab(next);
    if (event.type.startsWith("key") || (event instanceof MouseEvent && event.detail === 0)) {
      document.getElementById(`analytics-tab-${tab}`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
    startTransition(() => {
      setShown(tab);
      router.replace(tab === "overview" ? pathname : `${pathname}?tab=${tab}`, { scroll: false });
    });
  }

  return (
    <Tabs.Root value={shown} onValueChange={select} className="space-y-6">
      {/* The bar scrolls sideways on a narrow screen instead of widening the page. */}
      <div className="overflow-x-auto overflow-y-hidden overscroll-x-contain border-b [scrollbar-color:var(--ds-gray-500)_transparent] [scrollbar-width:thin]">
        <Tabs.List aria-label="Analytics views" className="flex w-max min-w-full gap-1">
          {ANALYTICS_TABS.map((t) => (
            <Tabs.Tab
              key={t.value}
              value={t.value}
              id={`analytics-tab-${t.value}`}
              aria-controls={t.value === shown ? PANEL_ID : undefined}
              className="-mb-px inline-flex min-h-11 shrink-0 cursor-pointer items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--dur-fast) ease-snappy hover:text-foreground focus-visible:outline-offset-[-2px] data-[active]:border-foreground data-[active]:text-foreground"
            >
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </div>
      <Tabs.Panel value={shown} id={PANEL_ID} aria-labelledby={`analytics-tab-${shown}`} aria-busy={pending || undefined} className="space-y-6 outline-offset-4">
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
