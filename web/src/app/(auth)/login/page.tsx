import { Suspense } from "react";
import Link from "next/link";
import { NestMark } from "@/components/nest-mark";
import { PixelField } from "@/components/pixel-field";
import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingRegion, Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { pixel } from "@/lib/fonts";
import { LOGIN_ERRORS, loginErrorMessage } from "@/lib/login-errors";
import { config, hackClubConfigured, localModeEnabled } from "@/server/config";
import { localPasswordConfigured } from "@/server/auth/local-credential";
import { cn } from "@/lib/utils";
import { PasswordResetForm } from "@/components/password-reset-form";

export const metadata = { title: "Log in" };

const shell =
  "relative isolate flex min-h-[100dvh] flex-1 items-center justify-center overflow-hidden bg-background px-4 py-12";

/**
 * The error and note boxes, drawn with the Alert tokens. ui/alert.tsx imports
 * the client build of Phosphor without "use client", which breaks when a server
 * component renders it, so this page uses the server-safe icons directly.
 * Swap back to <Alert> once that is fixed.
 */
function Notice({
  tone,
  role,
  className,
  children,
}: {
  tone: "note" | "error";
  role?: "alert";
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "error" ? WarningCircleIcon : InfoIcon;
  return (
    <div
      role={role}
      className={cn(
        "flex gap-3 rounded-lg p-4 text-foreground",
        tone === "error"
          ? "bg-[var(--tone-error-bg)] shadow-[0_0_0_1px_var(--tone-error-ring)]"
          : "bg-[var(--tone-note-bg)] shadow-[0_0_0_1px_var(--tone-note-ring)]",
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "error" ? "text-[var(--tone-error-icon)]" : "text-[var(--tone-note-icon)]"
        )}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Mark, title and card each arrive once, 60ms apart. */
function delay(ms: number): React.CSSProperties {
  return { "--enter-delay": `${ms}ms` } as React.CSSProperties;
}

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; local?: string; method?: string }>;
}) {
  const { error, local: localFlow, method } = await searchParams;
  // The optional password sign-in lives on its own views so the usual sign-in stays as it was.
  const passwordView = method === "password" || method === "reset" ? method : null;
  const hackClub = hackClubConfigured();
  const local = localModeEnabled();
  const localHasPassword = local ? await localPasswordConfigured() : false;
  const localReset = local && localHasPassword && localFlow === "reset";
  const dev = config().DEV_LOGIN && process.env.NODE_ENV !== "production";
  // When sign-in is not set up, the note below already says so.
  const showError = error && !(error === "not_configured" && !hackClub && !local);

  return (
    <main className={cn(pixel.variable, shell)}>
      <PixelField className="[mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
      <div className="relative w-full max-w-[360px]">
        <div className="motion-enter">
          <Link
            href="/"
            aria-label="Egg, home"
            className="touch-target mx-auto block w-fit rounded-md outline-offset-4"
          >
            <NestMark className="mx-auto size-10" />
          </Link>
        </div>
        <h1
          style={delay(60)}
          className="motion-enter font-pixel mt-6 text-center text-[28px] leading-8 font-medium"
        >
          Log in to Egg
        </h1>

        <div
          style={delay(120)}
          className="motion-enter mt-8 rounded-lg bg-card p-6 shadow-border-small"
        >
          {showError ? (
            <Notice tone="error" role="alert" className="mb-4">
              {loginErrorMessage(error)}
            </Notice>
          ) : null}

          {passwordView === "reset" ? (
            <PasswordResetForm />
          ) : passwordView === "password" ? (
            <form action="/api/auth/password" method="post">
              <label htmlFor="password-email" className="mb-1.5 block text-[13px] text-muted-foreground">
                Email
              </label>
              <Input id="password-email" name="email" type="email" autoComplete="email" required className="mb-3" />
              <label htmlFor="password-password" className="mb-1.5 block text-[13px] text-muted-foreground">
                Password
              </label>
              <Input id="password-password" name="password" type="password" autoComplete="current-password" required maxLength={256} className="mb-3" />
              <Button type="submit" size="lg" className="w-full">Sign in</Button>
              <p className="mt-3 text-[13px] text-muted-foreground">
                <Link href="/login?method=reset" className="link">Forgot your password?</Link>
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground">
                <Link href="/login" className="link">Back to sign in</Link>
              </p>
            </form>
          ) : (
          <>
          {local ? (
            localReset || !localHasPassword ? (
              <form action="/api/auth/local" method="post" className={hackClub ? "mb-3" : undefined}>
                <input type="hidden" name="flow" value={localReset ? "reset" : "setup"} />
                <label htmlFor="local-recovery-key" className="mb-1.5 block text-[13px] text-muted-foreground">
                  Recovery key from private <code>.env.local</code>
                </label>
                <Input id="local-recovery-key" name="recoveryKey" type="password" autoComplete="current-password" required className="mb-3" />
                {!localReset ? (
                  <p className="mb-3 text-[12px] text-muted-foreground">
                    This is the first sign-in after setup. Choose a password; Egg stores only a salted, slow password hash.
                  </p>
                ) : null}
                <label htmlFor="local-new-password" className="mb-1.5 block text-[13px] text-muted-foreground">
                  {localReset ? "New password (12 characters minimum)" : "Choose a password (12 characters minimum)"}
                </label>
                <Input id="local-new-password" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required className="mb-3" />
                <label htmlFor="local-confirm-password" className="mb-1.5 block text-[13px] text-muted-foreground">
                  Confirm password
                </label>
                <Input id="local-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required className="mb-3" />
                <Button type="submit" size="lg" className="w-full">
                  {localReset ? "Reset password and sign in" : "Set password and sign in"}
                </Button>
                {localReset ? (
                  <p className="mt-3 text-center text-[13px] text-muted-foreground"><Link href="/login" className="link">Back to sign in</Link></p>
                ) : null}
              </form>
            ) : (
              <form action="/api/auth/local" method="post" className={hackClub ? "mb-3" : undefined}>
                <input type="hidden" name="flow" value="login" />
                <label htmlFor="local-password" className="mb-1.5 block text-[13px] text-muted-foreground">
                  Local password
                </label>
                <Input id="local-password" name="password" type="password" autoComplete="current-password" required className="mb-3" />
                <Button type="submit" size="lg" className="w-full">Sign in on this computer</Button>
                <p className="mt-3 text-center text-[13px] text-muted-foreground">
                  <Link href="/login?local=reset" className="link">Reset with the recovery key</Link>
                </p>
              </form>
            )
          ) : null}

          {hackClub ? (
            <a
              href="/api/auth/login"
              className={cn(buttonVariants({ size: "lg" }), "w-full")}
            >
              Continue with Hack Club
            </a>
          ) : local ? null : (
            <>
              <Button size="lg" className="w-full" disabled aria-describedby="login-unavailable">
                Continue with Hack Club
              </Button>
              <Notice tone="note" className="mt-4">
                <span id="login-unavailable">{LOGIN_ERRORS.not_configured}</span>
              </Notice>
            </>
          )}
          {hackClub || !local ? (
            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              Hack Club Auth only confirms who you are. It doesn&apos;t give Egg access to your
              server.
            </p>
          ) : null}

          <p className="mt-4 text-[13px] text-muted-foreground">
            <Link href="/login?method=password" className="link">Sign in with a password</Link>
          </p>

          {dev ? (
            <form action="/api/auth/dev" method="post" className="mt-6 border-t pt-5">
              <label htmlFor="dev-name" className="mb-1.5 block text-[13px] text-muted-foreground">
                Development sign-in
              </label>
              <div className="flex gap-2">
                <Input id="dev-name" name="name" defaultValue="dev" autoComplete="off" />
                <Button type="submit" variant="outline" className="shrink-0 px-3">
                  Sign in
                </Button>
              </div>
              {local ? (
                <Input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Local password"
                  required
                  className="mt-2"
                />
              ) : null}
              <p className="mt-2 text-[12px] text-muted-foreground">
                Shown only because DEV_LOGIN is on and this is not a production build.
              </p>
            </form>
          ) : null}
          </>
          )}
        </div>
      </div>
    </main>
  );
}

/** Same column as the page: mark, title, then the card with its button and two caption lines. */
function LoginSkeleton() {
  return (
    <main className={shell}>
      <LoadingRegion label="Loading sign-in…" className="w-full max-w-[360px]">
        <Skeleton className="mx-auto size-10" />
        <div className="mt-6 flex h-8 items-center justify-center" aria-hidden="true">
          <Skeleton className="h-5 w-60" />
        </div>
        <div className="mt-8 rounded-lg bg-card p-6 shadow-border-small" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <SkeletonText size="label" lines={2} width="w-full" className="mt-4" />
        </div>
      </LoadingRegion>
    </main>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}
