import { createHmac } from "node:crypto";
import { config } from "@/server/config";
import { safeEqual } from "@/server/crypto";

/** A GitHub linking state value bound to the user who started the flow. */
export function createOAuthStateBinding(userId: string, state: string): string {
  return `${state}.${mac(userId, state)}`;
}

/** The bound state, or null when the value is missing, malformed or bound to someone else. */
export function verifyOAuthStateBinding(userId: string, value: string): string | null {
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const state = value.slice(0, dot);
  if (!safeEqual(value.slice(dot + 1), mac(userId, state))) return null;
  return state;
}

function mac(userId: string, state: string): string {
  return createHmac("sha256", config().APP_SECRET)
    .update(`${state}.${userId}`)
    .digest("hex");
}
