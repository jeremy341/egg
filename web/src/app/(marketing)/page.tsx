import { ContainerSwitches } from "@/components/home/container-switches";
import { GetStarted } from "@/components/home/get-started";
import { Hero } from "@/components/home/hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { OnceLive } from "@/components/home/once-live";
import { RuntimesTable } from "@/components/home/runtimes-table";

export const metadata = {
  title: { absolute: "Egg" },
  description:
    "Egg connects to your Hack Club Nest container, builds your GitHub repo on every push and runs it there, with logs, rollbacks and branch previews.",
};

/** Six sections: the promise, how a push goes live, what runs, what you get, what Egg can touch, how to start. */
export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <RuntimesTable />
      <OnceLive />
      <ContainerSwitches />
      <GetStarted />
    </>
  );
}
