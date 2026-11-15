"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

const utc = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/**
 * A clock time in the reader's own time zone. The server and the first client render show UTC with
 * its name, so both sides match; once the page is in the browser it switches to local time, the
 * same zone the log lines use.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const local = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const text = local
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : `${utc.format(date)} UTC`;
  return (
    <time dateTime={iso} title={local ? date.toLocaleString() : `${date.toISOString()}`} className={className}>
      {text}
    </time>
  );
}
