import type { ReactNode } from "react";
import { GUIDE_A } from "./guide-a";
import { GUIDE_B } from "./guide-b";
import { GUIDE_C } from "./guide-c";
import { GUIDE_D } from "./guide-d";
import { GUIDE_E } from "./guide-e";
import { GUIDE_API_A } from "./guide-api-a";
import { GUIDE_API_B } from "./guide-api-b";

/**
 * The body of every docs page, by page id from `_data/nav.ts`. Each entry
 * renders one whole page. The docs routes and the tests import this and
 * nothing else from `_content`.
 */
export const CONTENT: Record<string, () => ReactNode> = { ...GUIDE_A, ...GUIDE_B, ...GUIDE_C, ...GUIDE_D, ...GUIDE_E, ...GUIDE_API_A, ...GUIDE_API_B };
