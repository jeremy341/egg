"use client";

import { AppError } from "@/components/app-error";

/** Any dashboard page that fails to render lands here, inside the sidebar and top bar. */
export default function AppSegmentError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  return <AppError digest={error.digest} onRetry={retry ?? reset} />;
}
