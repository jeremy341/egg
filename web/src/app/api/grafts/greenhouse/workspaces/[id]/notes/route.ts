import { authed, handle, ok, readJson } from "@/server/http";
import { createWorkspaceNote, createWorkspaceNoteInput, getWorkspace } from "@/server/grafts/greenhouse";
import { requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("greenhouse");
  const { id } = await params;
  const result = await getWorkspace(user.id, id);
  return ok({ notes: result.notes });
});

export const POST = handle<Context>(async (req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("greenhouse");
  const { id } = await params;
  await createWorkspaceNote(user.id, id, await readJson(req, createWorkspaceNoteInput));
  return ok({ created: true }, 201);
});
