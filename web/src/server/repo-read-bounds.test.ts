import { describe, expect, it, vi } from "vitest";
import { readRepo } from "./repo-read";

const source = { repo: "owner/repo", branch: "main", installationId: null, rootDir: "" };

function oversizedStream(size: number) {
  const cancel = vi.fn();
  let sent = false;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (!cancelled) controller.close();
        return;
      }
      sent = true;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() { cancelled = true; cancel(); },
  });
  return { response: new Response(body), cancel };
}

describe("repository detection response limits", () => {
  it("stops reading an oversized repository file", async () => {
    const large = oversizedStream(220_000);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ tree: [{ path: "package.json", type: "blob" }] }))
      .mockResolvedValueOnce(large.response);
    const result = await readRepo(source, fetcher as typeof fetch);
    expect(result.status).toBe("ok");
    expect(large.cancel).toHaveBeenCalled();
  });

  it("stops reading an oversized repository tree", async () => {
    const large = oversizedStream(12_000_000);
    const result = await readRepo(source, vi.fn().mockResolvedValue(large.response) as typeof fetch);
    expect(result.status).toBe("unavailable");
    expect(large.cancel).toHaveBeenCalled();
  });

  it("cancels a response that declares an oversized tree before reading it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, { headers: { "content-length": "12000000" } });
    const result = await readRepo(source, vi.fn().mockResolvedValue(response) as typeof fetch);
    expect(result.status).toBe("unavailable");
    expect(cancel).toHaveBeenCalled();
  });
});
