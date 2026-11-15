"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SafeReportMarkdown } from "@/components/safe-report-markdown";
import { cn } from "@/lib/utils";

type Evidence = {
  name: string;
  type: "image/png" | "image/jpeg";
  data: string;
};
const initial = {
  title: "",
  location: "",
  impact: "",
  details: "",
  name: "",
  contact: "",
};
const area = cn(fieldClass, "h-auto min-h-28 resize-y py-2 max-sm:h-auto");
const labelClass = "block text-label font-medium text-foreground";
const hintClass = "text-caption font-normal text-muted-foreground";
/** A checkbox with its sentence: the whole row is the target, at least 40px tall on a phone. */
const checkRow = "flex cursor-pointer items-start gap-3 text-label max-sm:min-h-10";

export function SecurityReportForm() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [form, setForm] = useState(initial);
  const [anonymous, setAnonymous] = useState(true);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ enabled: boolean }>("/api/security-reports")
      .then((r) => {
        if (live) setEnabled(r.enabled);
      })
      .catch(() => {
        if (live) setEnabled(false);
      });
    return () => {
      live = false;
    };
  }, []);

  async function filesChanged(files: FileList | null) {
    setError(null);
    if (!files) return;
    if (files.length > 3) {
      setError("Choose up to three PNG or JPEG images.");
      return;
    }
    setReadingFiles(true);
    try {
      const selected = await Promise.all(
        Array.from(files).map(async (file): Promise<Evidence> => {
          if (
            !["image/png", "image/jpeg"].includes(file.type) ||
            file.size > 1_000_000
          )
            throw new Error("Use PNG or JPEG images no larger than 1 MB each.");
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = () =>
              reject(new Error("Could not read that image."));
            reader.readAsDataURL(file);
          });
          return { name: file.name, type: file.type as Evidence["type"], data };
        }),
      );
      setEvidence(selected);
    } catch (err) {
      setEvidence([]);
      setError(
        err instanceof Error ? err.message : "Could not read those files.",
      );
    } finally {
      setReadingFiles(false);
    }
  }
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ reference: string }>("/api/security-reports", {
        method: "POST",
        body: { ...form, anonymous, evidence },
      });
      setReference(r.reference);
      setForm(initial);
      setEvidence([]);
      setConfirm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the report.",
      );
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  if (enabled === null)
    return (
      <p role="status" className="text-label text-muted-foreground">
        Checking the private inbox…
      </p>
    );
  if (!enabled)
    return (
      <Alert tone="note" className="text-label">
        The operator has not enabled the private inbox on this instance. Please
        use the private advisory link above.
      </Alert>
    );
  if (reference)
    return (
      <Alert tone="success" role="status" title="Your report is in the private inbox." className="text-label">
        <p className="mt-1">
          Reference: <code className="font-mono break-all">{reference}</code>
        </p>
        <p className="mt-2">
          Only the configured administrator can read it. Anonymous reports have
          no reply channel. Keep the reference for any follow-up through the
          private advisory channel.
        </p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => {
            setReference(null);
            setAck(false);
          }}
        >
          Write another report
        </Button>
      </Alert>
    );

  const field = (
    key: keyof typeof initial,
    label: string,
    max: number,
    required = false,
    multiline = false,
  ) => (
    <label className={cn(labelClass, "space-y-1.5")} htmlFor={`report-${key}`}>
      <span className="block">{label}</span>
      {multiline ? (
        <textarea
          id={`report-${key}`}
          className={area}
          maxLength={max}
          required={required}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      ) : (
        <Input
          id={`report-${key}`}
          maxLength={max}
          required={required}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <>
      <form
        aria-labelledby="report-form-title"
        className="mt-2 border bg-background text-body text-foreground"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setAck(false);
          setConfirm(true);
        }}
      >
        <div className="border-b bg-background-subtle px-4 py-3 sm:px-5">
          <h3 id="report-form-title" className="text-title-3">
            Send a private report here
          </h3>
          <p className="mt-0.5 text-label text-muted-foreground">
            Include the affected page, impact, and safe steps to reproduce it.
            Remove real credentials, unrelated personal data, and identifying
            image metadata.
          </p>
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          {field("title", "Short title", 160, true)}
          {field("location", "Affected URL, endpoint, or version", 1000)}
          {field(
            "impact",
            "What could someone do with this issue?",
            5000,
            true,
            true,
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="report-details" className={labelClass}>
                Steps, observations, and proof
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={preview}
                onClick={() => setPreview(!preview)}
              >
                {preview ? "Edit Markdown" : "Preview Markdown"}
              </Button>
            </div>
            <p className={hintClass}>
              Supports headings, lists, code blocks, emphasis, and links. HTML and
              remote images are not rendered.
            </p>
            {preview ? (
              <div className="min-h-56 rounded-md border border-input p-3">
                <SafeReportMarkdown
                  source={form.details || "Your preview will appear here."}
                />
              </div>
            ) : (
              <textarea
                id="report-details"
                className={cn(area, "min-h-56 font-mono")}
                maxLength={30_000}
                minLength={20}
                required
                value={form.details}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
                placeholder={
                  "## Steps to reproduce\n1. …\n\n## Expected behavior\n…\n\n## Actual behavior\n…"
                }
              />
            )}
          </div>
          <label className={cn(labelClass, "space-y-1.5")} htmlFor="report-evidence">
            <span className="block">Evidence images (optional)</span>
            <Input
              id="report-evidence"
              type="file"
              accept="image/png,image/jpeg"
              multiple
              className="cursor-pointer file:mr-3 file:cursor-pointer"
              onChange={(e) => void filesChanged(e.target.files)}
            />
            <span className={cn(hintClass, "block")}>
              Up to 3 PNG/JPEG images, 1 MB and 16 million pixels each. Other
              proof can go in a fenced code block. Do not send executable files.
            </span>
          </label>
          {evidence.length ? (
            <ul aria-label="Attached images" className="hairline-y rounded-md border border-input text-label">
              {evidence.map((image, i) => (
                <li
                  key={`${image.name}-${i}`}
                  className="flex items-center justify-between gap-3 py-1.5 pr-1.5 pl-3"
                >
                  <span className="min-w-0 truncate">{image.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${image.name}`}
                    onClick={() =>
                      setEvidence(evidence.filter((_, n) => n !== i))
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className={checkRow}>
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="font-medium">Submit without my identity</span>
              <span className={cn(hintClass, "mt-1 block")}>
                Egg will not attach your signed-in account or save an IP address
                with this report. Hosting and proxy logs may still contain request
                metadata; text and image metadata can identify you.
              </span>
            </span>
          </label>
          {!anonymous ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {field("name", "Name or handle (optional)", 120)}
              {field("contact", "Reply address (optional)", 320)}
            </div>
          ) : null}
          {error ? (
            <Alert tone="error" role="alert" className="text-label">
              {error}
            </Alert>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background-subtle px-4 py-3 sm:px-5">
          <p className={hintClass}>You review the report once more before it is sent.</p>
          <Button
            type="submit"
            disabled={
              busy ||
              readingFiles ||
              form.details.trim().length < 20 ||
              form.impact.trim().length < 10 ||
              form.title.trim().length < 5
            }
          >
            {readingFiles ? "Reading evidence…" : "Review and send"}
          </Button>
        </div>
      </form>
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent size="lg">
          <div className="border-b p-5">
            <DialogTitle>Confirm your vulnerability report</DialogTitle>
            <DialogDescription className="mt-1 text-label">
              This goes to the configured administrator of this Egg instance.
            </DialogDescription>
          </div>
          <div className="space-y-4 overflow-y-auto p-5">
            <p className="text-body-lg font-semibold break-words">{form.title}</p>
            <dl className="space-y-3">
              <div>
                <dt className="text-label text-muted-foreground">Affected location</dt>
                <dd className="mt-0.5 break-words">
                  {form.location || "Not supplied"}
                </dd>
              </div>
              <div>
                <dt className="text-label text-muted-foreground">Impact</dt>
                <dd className="mt-0.5 break-words whitespace-pre-wrap">{form.impact}</dd>
              </div>
            </dl>
            <SafeReportMarkdown source={form.details} />
            <p>
              {evidence.length} evidence image{evidence.length === 1 ? "" : "s"}{" "}
              attached.{" "}
              {anonymous
                ? "No account identity will be attached."
                : `Identity: ${form.name || "No name supplied"}; reply: ${form.contact || "No address supplied"}`}
            </p>
            {evidence.map((image, i) => (
              <figure key={i} className="rounded-md border p-2">
                <Image
                  src={`data:${image.type};base64,${image.data}`}
                  alt={`Evidence ${i + 1}: ${image.name}`}
                  width={600}
                  height={400}
                  unoptimized
                  className="max-h-64 w-full object-contain"
                />
                <figcaption className="mt-1 text-caption font-normal break-words text-muted-foreground">
                  {image.name}
                </figcaption>
              </figure>
            ))}
            <Alert tone="note" title="Use this channel responsibly." className="text-label">
              Anonymous reports
              are welcome. If this feature is abused, the operator may introduce
              IP-based tracking or blocking, including permanent bans, with an
              updated notice before new collection begins. Persistent IP tracking
              and permanent bans are not implemented by this form; temporary
              in-memory submission limits apply. Infrastructure logs may already
              record connection metadata.
            </Alert>
            <label className={checkRow}>
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 size-4 shrink-0"
              />
              <span className="min-w-0">
                I have reviewed this report, removed secrets and unrelated
                personal data, and understand this notice.
              </span>
            </label>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t bg-background-subtle p-4">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Back to edit
            </Button>
            <Button
              disabled={!ack || busy}
              loading={busy}
              onClick={() => void send()}
            >
              Send private report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
