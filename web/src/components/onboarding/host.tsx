"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Marks, OnboardingFacts } from "@/lib/onboarding-marks";
import { createController, type Controller } from "@/components/onboarding/controller";
import { onReplayRequest } from "@/components/onboarding/replay";

/**
 * Mounted once in the dashboard layout and once in the new-project layout (through AccountLoader,
 * which both use). It renders nothing. It makes one controller per page, ends it on every route
 * change, and keeps only what the three marks need: nothing else about the tour is stored.
 *
 * `facts` and `marks` come from the layout's server render. After a key is made, a connection
 * tested or a domain saved, the page already calls router.refresh(), which sends fresh facts and
 * lets the controller pick the next step. A layout is not rendered again when moving between its
 * pages, so a mark saved here is also kept in `overrides` until the next full render.
 */
export function OnboardingHost({
  facts,
  marks,
  localMode,
}: {
  facts: OnboardingFacts;
  marks: Marks;
  localMode: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const data = useRef({ facts, marks, localMode });
  const overrides = useRef<Marks>({});
  const controller = useRef<Controller | null>(null);

  useEffect(() => {
    data.current = { facts, marks, localMode };
    controller.current?.refresh();
  }, [facts, marks, localMode]);

  useEffect(() => {
    const c = createController({
      path: pathname,
      data: () => ({
        facts: data.current.facts,
        marks: { ...data.current.marks, ...overrides.current },
        localMode: data.current.localMode,
      }),
      saveMark: (chapter, status) => {
        if ({ ...data.current.marks, ...overrides.current }[chapter] === status) return;
        overrides.current = { ...overrides.current, [chapter]: status };
        // keepalive lets the request finish even if the page is already being left (Deploy opens the next page).
        void fetch("/api/onboarding", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chapter, status }),
          keepalive: true,
        }).catch(() => {
          // A mark that is not saved only means the tour may offer itself once more.
        });
      },
      navigate: (href) => router.push(href),
    });
    controller.current = c;
    // "Show the tour again" already cleared the saved marks; forget what this page kept for itself.
    const off = onReplayRequest(() => {
      overrides.current = {};
      c.refresh();
    });
    return () => {
      off();
      c.dispose();
      controller.current = null;
    };
  }, [pathname, router]);

  return null;
}
