import { HOME_FACTS } from "@/components/marketing/home-facts";
import { Cell } from "@/components/marketing/readout";
import { FRAME } from "./shared";

/**
 * Every line is wording the pipeline writes (pipeline.ts, build.ts). The
 * repository, user and commit are made up, and the frame says "Sample".
 */
const HASH = "e41b7d2";
const PORT = HOME_FACTS.defaultPort;
const STEPS = [
  "Deploying recipe-api (production) to sam-r@hackclub.app",
  "Cloning https://github.com/sam-r/recipe-api (branch main)",
  "Building: npm ci && npm run build",
  "Connecting to your Nest container",
  `Waiting for the app to answer on port ${PORT}`,
] as const;
const DONE = `Live on port ${PORT}. Map your domain to this port in the Nest dashboard.`;

/** When a line of the page's one entrance appears, in seconds. Only runs when motion is allowed (globals.css, .rd-line). */
const at = (i: number) => ({ "--rd-at": `${0.25 + i * 0.35}s` }) as React.CSSProperties;

const line = "rd-line grid grid-cols-[30px_minmax(0,1fr)] items-start [overflow-wrap:anywhere]";

/**
 * The hero's picture: the log of one push, from the command to the line that
 * says it is live. The server renders it finished; with motion allowed the
 * lines appear once, in order. Lines wrap on a phone instead of scrolling.
 */
export function PushLog() {
  return (
    <figure className={`m-0 min-w-0 ${FRAME}`}>
      <figcaption className="flex h-[45px] items-center justify-between border-b border-border px-4 text-[0.8125rem] text-muted-foreground">
        <span>Deploy log</span>
        <span>Sample</span>
      </figcaption>
      <ol className="m-0 list-none py-[15px] pr-4 pl-1 font-mono text-[0.8125rem] leading-[30px] sm:text-[0.875rem]">
        <li className={`${line} text-foreground`} style={at(0)}>
          <span aria-hidden="true" className="text-center text-subtle-foreground">
            $
          </span>
          <span>
            git push origin main <span className="text-muted-foreground">{HASH}</span>
          </span>
        </li>
        {STEPS.map((text, i) => (
          <li key={text} className={`${line} text-muted-foreground`} style={at(i + 1)}>
            <span aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
        <li className={`${line} font-medium text-foreground`} style={at(STEPS.length + 1)}>
          <Cell state="accent" className="-mt-px" />
          <span>{DONE}</span>
        </li>
      </ol>
    </figure>
  );
}
