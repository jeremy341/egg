/** What the sign-in page says for each `?error=` code. */
export const LOGIN_ERRORS: Record<string, string> = {
  not_configured: "Hack Club sign-in is not set up on this installation yet.",
  denied: "You did not approve the sign-in. Try again when you are ready.",
  invalid_request: "That sign-in link was not valid. Please try again.",
  state_mismatch: "The sign-in took too long or came from another browser. Please try again.",
  login_failed: "Hack Club could not sign you in. Please try again in a moment.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
  password_invalid: "That password or recovery key is not right.",
  local_password: "The local password is incorrect.",
  local_recovery: "The recovery key is incorrect. Check the private .env.local file.",
  local_password_invalid: "Use a password at least 12 characters long and no more than 256 bytes.",
  local_password_mismatch: "The new passwords do not match.",
  local_password_conflict: "The local password changed in another request. Try again or sign in.",
};

export function loginErrorMessage(code: string): string {
  return Object.hasOwn(LOGIN_ERRORS, code) ? LOGIN_ERRORS[code] : "Something went wrong signing in.";
}
