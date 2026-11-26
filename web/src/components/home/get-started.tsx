import Link from "next/link";
import { BODY, BUTTON, BUTTON_PRIMARY, FRAME, H2, H3, SECTION } from "./shared";

const STEPS = [
  {
    title: "Add a key",
    body: "Enter your Nest username, paste the key Egg gives you on the SSH Keys page of the Nest dashboard, then press Test connection.",
  },
  {
    title: "Import a repository",
    body: "Pick one from your GitHub list or paste a public address, then press Deploy.",
  },
  {
    title: "Push",
    body: "Your production branch deploys. Every other branch becomes a preview.",
  },
] as const;

// Answers checked against the code: layout.ts (folder, nd- units, markers),
// servers.ts deleteServer (cascade), crypto.ts and projects.ts (sealed, names
// only, written to .env at deploy), the GitHub App install flow.
const QUESTIONS: ReadonlyArray<readonly [question: string, answer: string]> = [
  [
    "Is Egg part of Nest?",
    "No. Egg is an independent add-on by a Hack Club member. It reaches your container over SSH with a key you can delete at any time.",
  ],
  [
    "What does it change on my container?",
    "Each project gets a folder under ~/.nest-deploy with its releases and a current link, plus one nd- service. Anything without Egg's marker is left alone.",
  ],
  [
    "Can I leave?",
    "Yes. Disconnecting a server removes its projects, logs and variables from Egg and leaves your apps running on the container.",
  ],
  [
    "Are my variables safe?",
    "They are stored encrypted and never sent back to the browser or the API, so you see names only. At deploy time they are written to a .env file only your user can read.",
  ],
  [
    "Can I deploy a private repository?",
    "Yes. Install the GitHub App and give it access to that repository.",
  ],
];

/**
 * The close: what it takes to start, with the one Sign in button, and the
 * questions people ask before they connect, side by side.
 */
export function GetStarted() {
  return (
    <section id="start" aria-labelledby="start-title" className={SECTION}>
      <div className="grid grid-cols-1 gap-y-[90px] lg:grid-cols-12 lg:gap-x-6">
        <div className="lg:col-span-5">
          <h2 id="start-title" className={H2}>
            Three steps to your first push
          </h2>
          <p className={`${BODY} mt-5 max-w-[40ch]`}>You need a Nest container and a GitHub repository.</p>

          <ol className="m-0 mt-10 list-none p-0">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[48px_minmax(0,1fr)] border-t border-border py-5">
                <span aria-hidden="true" className="font-pixel text-[1.75rem] leading-[1.875rem] text-foreground">
                  {i + 1}
                </span>
                <div>
                  <h3 className={H3}>{step.title}</h3>
                  <p className="m-0 mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <Link href="/login" className={`${BUTTON} ${BUTTON_PRIMARY} mt-[30px]`}>
            Sign in
          </Link>
        </div>

        <div id="faq" className="min-w-0 scroll-mt-[90px] lg:col-span-6 lg:col-start-7">
          <h2 className="text-[1.5rem] leading-[1.875rem] font-semibold tracking-[-0.015em]">Questions</h2>
          <div className={`faq ${FRAME} mt-6 divide-y divide-border`}>
            {QUESTIONS.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  <span className="text-[1rem] leading-6 font-medium">{question}</span>
                  <span aria-hidden="true" className="faq-icon" />
                </summary>
                <p className="m-0 text-[0.9375rem]">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
