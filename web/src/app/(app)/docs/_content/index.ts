import type { ReactNode } from "react";
import { GUIDE_A } from "./guide-a";
import { GUIDE_B } from "./guide-b";
import { GUIDE_C } from "./guide-c";
import { GUIDE_D } from "./guide-d";

/**
 * The body of every docs page, by page id from `_data/nav.ts`. Each entry
 * renders one whole page. The docs routes and the tests import this and
 * nothing else from `_content`.
 */
export const CONTENT: Record<string, () => ReactNode> = { ...GUIDE_A, ...GUIDE_B, ...GUIDE_C, ...GUIDE_D };
