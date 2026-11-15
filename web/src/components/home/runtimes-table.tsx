import { BODY, FRAME, H2, SECTION, SMALL } from "./shared";

/*
 * Every command comes from INSTALL, RUN and resolveStartCommand in
 * server/deploy/runtime.ts (the start commands are checked in
 * home-facts.test.ts). On a phone each runtime becomes its own block, so the
 * table never scrolls sideways.
 */

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[0.875em] text-foreground">{children}</code>
);

const ROWS: { runtime: string; installs: React.ReactNode; starts: React.ReactNode }[] = [
  {
    runtime: "Node.js",
    installs: (
      <>
        <Code>npm ci</Code>, or pnpm or yarn when your lockfile says so
      </>
    ),
    starts: <Code>npm start</Code>,
  },
  {
    runtime: "Python",
    installs: (
      <>
        <Code>pip install -r requirements.txt</Code> in a virtual environment
      </>
    ),
    starts: <Code>python3 app.py</Code>,
  },
  {
    runtime: "Static site",
    installs: "Your build command, run in the sandbox",
    starts: "Served from your output folder",
  },
  {
    runtime: "Your own command",
    installs: "Your install command, if you set one",
    starts: "The start command you set",
  },
];

const CELL = "block px-0 py-0 text-left align-top sm:table-cell sm:px-5 sm:py-4";

export function RuntimesTable() {
  return (
    <section id="runtimes" aria-labelledby="runtimes-title" className={SECTION}>
      <div className="grid grid-cols-1 gap-y-10 lg:grid-cols-12 lg:gap-x-6">
        <div className="lg:col-span-4">
          <h2 id="runtimes-title" className={H2}>
            Node.js, Python and static sites
          </h2>
          <p className={`${BODY} mt-5 max-w-[40ch]`}>
            Egg reads your lockfile or requirements file and picks the install step. Anything else can run with a
            command you set.
          </p>
        </div>

        <div className="min-w-0 lg:col-span-8">
          <table className={`${FRAME} w-full border-collapse text-[0.9375rem] leading-6`}>
            <caption className="sr-only">What Egg installs and runs for each kind of app</caption>
            <thead className="max-sm:sr-only">
              <tr className="border-b border-border bg-[var(--ds-gray-100)] text-[0.8125rem] text-foreground">
                <th scope="col" className="w-[24%] px-5 py-3 text-left font-semibold">
                  Runtime
                </th>
                <th scope="col" className="px-5 py-3 text-left font-semibold">
                  Installs with
                </th>
                <th scope="col" className="px-5 py-3 text-left font-semibold">
                  Starts with
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.runtime} className="block border-t border-border p-4 first:border-t-0 sm:table-row sm:p-0">
                  <th scope="row" className={`${CELL} font-semibold text-foreground`}>
                    {row.runtime}
                  </th>
                  <td className={`${CELL} mt-1 text-muted-foreground`}>
                    <span className="font-medium text-foreground sm:hidden">Installs: </span>
                    {row.installs}
                  </td>
                  <td className={`${CELL} mt-1 text-muted-foreground`}>
                    <span className="font-medium text-foreground sm:hidden">Starts: </span>
                    {row.starts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`${SMALL} mt-4`}>Go, Ruby and Rust are recognised but not supported yet.</p>
        </div>
      </div>
    </section>
  );
}
