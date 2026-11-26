import Link from "next/link";
import { PushLog } from "./push-log";
import { BODY, BUTTON, BUTTON_PRIMARY, BUTTON_SECONDARY, DISPLAY } from "./shared";

/**
 * The first screen. The headline runs the full width; under it the promise and
 * the two buttons sit left of the log of one real push. On a phone everything
 * stacks: headline, promise, buttons, log.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="board-col pt-[60px] lg:pt-[90px]">
      <h1 id="hero-title" className={DISPLAY}>
        <span className="block">Push to GitHub.</span> <span className="block">Live on your Nest.</span>
      </h1>

      <div className="mt-[30px] grid grid-cols-1 gap-y-[60px] lg:mt-[60px] lg:grid-cols-12 lg:gap-x-6">
        <div className="lg:col-span-4">
          <p className={`${BODY} max-w-[34ch] text-[1.1875rem] leading-[1.875rem]`}>
            Egg connects to your Nest container over SSH. Each push to your production branch is built, started and
            checked there.
          </p>
          <div className="mt-[30px] flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className={`${BUTTON} ${BUTTON_PRIMARY}`}>
              Sign in
            </Link>
            <a href="#product" className={`${BUTTON} ${BUTTON_SECONDARY}`}>
              See what a push does
            </a>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-8">
          <PushLog />
        </div>
      </div>
    </section>
  );
}
