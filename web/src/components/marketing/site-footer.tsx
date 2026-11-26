import Link from "next/link";
import { NestMark } from "@/components/nest-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { footerLinks } from "@/lib/marketing-nav";
import { REPO_URL } from "@/lib/site";

const link =
  "inline-flex min-h-10 items-center text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground sm:min-h-[30px]";

/**
 * The footer, on the plain surface: who makes Egg and how it relates to Nest
 * on the left, every link in one list on the right, and the theme switch
 * under it. No columns that repeat the top bar.
 */
export function SiteFooter() {
  return (
    <footer className="mt-[120px] border-t border-border bg-background lg:mt-[180px]">
      <div className="board-col grid grid-cols-1 gap-y-[30px] py-[60px] lg:grid-cols-12 lg:gap-x-6">
        <div className="lg:col-span-6">
          <Link href="/" className="flex w-fit items-center gap-2 outline-offset-4">
            <NestMark className="size-6" />
            <span className="font-pixel text-[1.375rem] leading-none font-semibold">Egg</span>
          </Link>
          <p className="m-0 mt-4 max-w-[52ch] text-[0.9375rem] leading-6 text-muted-foreground">
            An independent project by a Hack Club member. Egg connects to your Nest container. It is not part of
            Nest and not an official Hack Club product.
          </p>
        </div>

        <div className="flex flex-col gap-[30px] lg:col-span-6 lg:items-end">
          <nav aria-label="Footer">
            <ul className="m-0 flex list-none flex-wrap gap-x-6 p-0 text-[0.875rem] lg:justify-end">
              {footerLinks().map((n) => (
                <li key={n.href}>
                  {n.href.includes("#") ? (
                    <a href={n.href} className={link}>
                      {n.label}
                    </a>
                  ) : (
                    <Link href={n.href} className={link}>
                      {n.label}
                    </Link>
                  )}
                </li>
              ))}
              <li>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className={link}>
                  GitHub
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            </ul>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
