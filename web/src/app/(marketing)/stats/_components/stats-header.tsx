import { cn } from "@/lib/utils";
import { WRAP } from "./layout";

export function StatsHeader() {
  return (
    <header className={cn(WRAP, "pt-[60px] pb-10 lg:pt-[120px] lg:pb-[60px]")}>
      <h1 className="font-pixel text-docs-h1 text-foreground max-sm:text-[44px] max-sm:leading-12">Stats</h1>
      <p className="mt-5 max-w-[56ch] text-docs-lead text-muted-foreground">
        How much Egg gets used, in rounded totals: sign-ups, how deployments end and how long builds take. Recounted every few minutes.
      </p>
    </header>
  );
}
