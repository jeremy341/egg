import Link from "next/link";
import { AcceptInvite } from "@/components/accept-invite";
import { NestMark } from "@/components/nest-mark";
import { pixel } from "@/lib/fonts";

// An invitation is for whoever has the link, not for search engines. The token sits after the # in the address, which a
// browser never sends to a server, so this page is the same for everyone and holds no secret.
export const metadata = {
  title: "Join a project",
  robots: { index: false, follow: false },
};

export default function InvitePage() {
  return (
    <main className={`${pixel.variable} mx-auto flex min-h-svh w-full max-w-[480px] flex-col justify-center px-4 py-16`}>
      <Link href="/" aria-label="Egg, home" className="mb-8 flex w-fit items-center gap-2 rounded-md">
        <NestMark className="size-6" />
        <span className="font-pixel text-[21px] leading-none font-semibold">Egg</span>
      </Link>
      <h1 className="text-title-1">You have been invited to a project</h1>
      <p className="mt-2 mb-6 text-muted-foreground">
        The project owner gave you access on Egg. Accept to add the project to your list. You need to be signed in with the
        account they invited.
      </p>
      <AcceptInvite />
    </main>
  );
}
