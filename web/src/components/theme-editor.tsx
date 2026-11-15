"use client";

import { useId, useMemo, useRef, useState } from "react";
import { api } from "@/components/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  QUICK_DEFAULTS,
  QUICK_FIELDS,
  THEME_NAME_MAX,
  checkContrast,
  checkThemeName,
  deriveTokens,
  describePair,
  parseThemeInput,
  quickFromTokens,
  type ContrastPair,
  type CustomThemeView,
  type QuickColors,
  type QuickKey,
  type ThemeScheme,
  type ThemeTokenName,
  type ThemeTokens,
} from "@/lib/custom-theme";
import { isHexColor, parseHex, toHex } from "@/lib/theme-color";
import { cn } from "@/lib/utils";

/** What the editor opens with: a saved theme, an imported one (not saved yet), or a blank one. */
export type ThemeDraft = {
  /** Set for a theme that is already saved. */
  id?: string;
  name: string;
  scheme: ThemeScheme;
  tokens: ThemeTokens;
};

export function blankDraft(scheme: ThemeScheme = "light"): ThemeDraft {
  return { name: "", scheme, tokens: deriveTokens(QUICK_DEFAULTS[scheme], scheme) };
}

/** Which of the eight colours a suggested fix changes. Button text is built from the primary, so it has none. */
const FIX_FIELD: Partial<Record<ThemeTokenName, QuickKey>> = {
  foreground: "text",
  "muted-foreground": "muted",
  link: "link",
  destructive: "danger",
  "ds-focus-color": "link",
};

/** A colour picked with the swatch has no see-through part, so keep the one the field already had. */
function keepAlpha(picked: string, previous: string): string {
  const old = parseHex(previous);
  if (!old || old[3] >= 1) return picked;
  return `${picked}${Math.round(old[3] * 255).toString(16).padStart(2, "0")}`;
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const ok = isHexColor(value);
  const parsed = ok ? parseHex(value) : null;
  return (
    <div>
      <label htmlFor={`${id}-text`} className="mb-1 block text-label font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}, colour picker`}
          value={parsed ? toHex(parsed) : "#000000"}
          onChange={(e) => onChange(keepAlpha(e.target.value, value))}
          className="touch-target h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 outline-none focus-visible:border-[var(--ds-focus-color)] focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ds-focus-color)_25%,transparent)] max-sm:h-10"
        />
        <Input
          id={`${id}-text`}
          value={value}
          maxLength={9}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          aria-invalid={ok ? undefined : true}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const v = e.target.value.trim();
            // A pasted hex without the # is still a hex.
            onChange(v !== "" && /^[0-9a-f]/i.test(v) ? `#${v}` : v);
          }}
          className="font-mono"
        />
      </div>
      <p id={`${id}-hint`} className={cn("mt-1 text-caption", ok ? "text-muted-foreground" : "text-destructive")}>
        {ok ? hint : "Use # and 3, 4, 6 or 8 hex digits, such as #1a2b3c."}
      </p>
    </div>
  );
}

/**
 * A small sample page drawn with the candidate colours. The colours are set on
 * these elements only (inline), never on the page around them, and each one is
 * checked with the same hex rule first.
 */
function Preview({ tokens }: { tokens: ThemeTokens }) {
  const c = (name: ThemeTokenName) => (isHexColor(tokens[name]) ? tokens[name] : "transparent");
  const line = `1px solid ${c("ds-gray-alpha-400")}`;
  return (
    <div
      aria-hidden="true"
      className="flex h-44 overflow-hidden rounded-lg text-[13px] leading-5 max-sm:h-48"
      style={{ background: c("ds-background-200"), color: c("foreground"), border: line }}
    >
      <div className="flex w-28 shrink-0 flex-col gap-1 p-2 max-sm:w-24" style={{ background: c("ds-background-100"), borderRight: line }}>
        <span className="font-semibold">Egg</span>
        <span className="rounded px-1.5 py-0.5" style={{ background: c("selected"), color: c("selected-foreground") }}>
          Projects
        </span>
        <span className="px-1.5 py-0.5" style={{ color: c("muted-foreground") }}>
          Activity
        </span>
        <span className="px-1.5 py-0.5" style={{ color: c("muted-foreground") }}>
          Settings
        </span>
      </div>
      <div className="min-w-0 flex-1 p-3">
        <div className="rounded-md p-3" style={{ background: c("ds-background-100"), border: line }}>
          <div className="flex items-center gap-2">
            <span className="font-semibold">my-site</span>
            <span
              className="rounded-full px-2 text-[12px] leading-5"
              style={{ background: c("ds-red-100"), color: c("destructive") }}
            >
              Failed
            </span>
          </div>
          <p style={{ color: c("muted-foreground") }}>Last deploy 2 minutes ago</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="rounded-md px-3 py-1 font-medium" style={{ background: c("primary"), color: c("primary-foreground") }}>
              Deploy
            </span>
            <span className="underline underline-offset-2" style={{ color: c("link") }}>
              View logs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function status(p: ContrastPair): { text: string; tone: string } {
  if (p.pass) return { text: "Pass", tone: "text-success" };
  return p.level === "block" ? { text: "Fail: blocks saving", tone: "text-destructive" } : { text: "Warning: allowed", tone: "text-warning" };
}

export function ThemeEditor({
  draft,
  atLimit,
  onClose,
  onSaved,
  onDeleted,
  onExport,
}: {
  draft: ThemeDraft;
  /** The account already has 20 themes, so a new one cannot be saved. */
  atLimit: boolean;
  onClose: () => void;
  onSaved: (theme: CustomThemeView, created: boolean) => void;
  onDeleted: (id: string) => void;
  onExport: (theme: ThemeDraft) => void;
}) {
  const uid = useId();
  const [name, setName] = useState(draft.name);
  const [scheme, setScheme] = useState<ThemeScheme>(draft.scheme);
  const [colors, setColors] = useState<QuickColors>(() => quickFromTokens(draft.tokens));
  // Until a colour or the scheme changes, an opened or imported theme keeps every colour it came with.
  const [touched, setTouched] = useState(false);
  const [savedId, setSavedId] = useState(draft.id ?? null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const colorsValid = QUICK_FIELDS.every((f) => isHexColor(colors[f.key]));
  const tokens = useMemo(() => {
    if (!touched) return draft.tokens;
    // While a field holds something that is not a colour yet, the sample keeps that colour from before.
    const base = quickFromTokens(draft.tokens);
    const usable = Object.fromEntries(QUICK_FIELDS.map((f) => [f.key, isHexColor(colors[f.key]) ? colors[f.key] : base[f.key]])) as QuickColors;
    return deriveTokens(usable, scheme);
  }, [touched, colors, scheme, draft.tokens]);
  const report = useMemo(() => checkContrast(tokens, scheme), [tokens, scheme]);
  const nameCheck = checkThemeName(name);

  function setColor(key: QuickKey, value: string) {
    setTouched(true);
    setSaved(false);
    setColors((c) => ({ ...c, [key]: value }));
  }

  function pickScheme(next: ThemeScheme) {
    if (next === scheme) return;
    setSaved(false);
    // A theme still on the starting colours of its scheme takes the other scheme's starting colours.
    const untouchedStart = QUICK_FIELDS.every((f) => colors[f.key].toLowerCase() === QUICK_DEFAULTS[scheme][f.key]);
    setScheme(next);
    setTouched(true);
    if (untouchedStart) setColors(QUICK_DEFAULTS[next]);
  }

  async function save() {
    setError(null);
    setSaved(false);
    setConfirmDelete(false);
    if (!savedId && atLimit) {
      setError("You already have 20 custom themes. Delete one to make room.");
      return;
    }
    if (!nameCheck.ok) {
      setError(nameCheck.error);
      nameRef.current?.focus();
      return;
    }
    if (!colorsValid) {
      setError("Fix the colours marked below first.");
      return;
    }
    const input = parseThemeInput({ name, scheme, tokens });
    if (!input.ok) {
      setError(input.error);
      return;
    }
    if (report.blocking.length > 0) {
      setError(`Not saved. ${report.blocking.map(describePair).join(" ")}`);
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ theme: CustomThemeView }>(savedId ? `/api/themes/${savedId}` : "/api/themes", {
        method: savedId ? "PUT" : "POST",
        body: input.value,
      });
      const created = savedId === null;
      setSavedId(res.theme.id);
      setSaved(true);
      onSaved(res.theme, created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!savedId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/api/themes/${savedId}`, { method: "DELETE" });
      onDeleted(savedId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setSaving(false);
    }
  }

  const failing = report.pairs.filter((p) => !p.pass);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="lg"
        className="max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-dvw max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
      >
        <div className="border-b px-5 py-4 max-sm:px-4">
          <DialogTitle>{savedId ? "Edit theme" : "New theme"}</DialogTitle>
          <DialogDescription className="mt-1 max-w-[60ch] text-label">
            Pick eight colours. Egg builds the rest from them and checks that the text can be read.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 max-sm:px-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor={`${uid}-name`} className="mb-1 block text-label font-medium">
                Name
              </label>
              <Input
                ref={nameRef}
                id={`${uid}-name`}
                value={name}
                maxLength={THEME_NAME_MAX * 2}
                autoComplete="off"
                aria-invalid={name !== "" && !nameCheck.ok ? true : undefined}
                aria-describedby={`${uid}-name-hint`}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
              />
              <p id={`${uid}-name-hint`} className={cn("mt-1 text-caption", name !== "" && !nameCheck.ok ? "text-destructive" : "text-muted-foreground")}>
                {name !== "" && !nameCheck.ok ? nameCheck.error : `Up to ${THEME_NAME_MAX} characters.`}
              </p>
            </div>
            <fieldset className="min-w-0">
              <legend className="mb-1 text-label font-medium">Scheme</legend>
              <div className="flex gap-4">
                {(["light", "dark"] as const).map((s) => (
                  <label key={s} className="touch-target flex min-h-9 cursor-pointer items-center gap-2 max-sm:min-h-10">
                    <input type="radio" name={`${uid}-scheme`} value={s} checked={scheme === s} onChange={() => pickScheme(s)} />
                    <span>{s === "light" ? "Light" : "Dark"}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-label font-medium">Colours</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {QUICK_FIELDS.map((f) => (
                <ColorField
                  key={f.key}
                  id={`${uid}-${f.key}`}
                  label={f.label}
                  hint={f.hint}
                  value={colors[f.key]}
                  onChange={(v) => setColor(f.key, v)}
                />
              ))}
            </div>
          </fieldset>

          <section aria-labelledby={`${uid}-preview`}>
            <h3 id={`${uid}-preview`} className="mb-2 text-label font-medium">
              Preview
            </h3>
            <Preview tokens={tokens} />
            <p className="mt-1.5 text-caption text-muted-foreground">
              A sample of your colours only. The results below say the same in words.
            </p>
          </section>

          <section aria-labelledby={`${uid}-contrast`}>
            <h3 id={`${uid}-contrast`} className="mb-1 text-label font-medium">
              Contrast
            </h3>
            <p role="status" className="mb-2 text-label text-muted-foreground">
              {report.blocking.length > 0
                ? "Body text is too faint on the page or a card, so this theme cannot be saved yet."
                : failing.length > 0
                  ? `${failing.length} ${failing.length === 1 ? "warning" : "warnings"}. You can still save.`
                  : "Every check passes."}
            </p>
            <ul className="divide-y rounded-md shadow-border-base">
              {report.pairs.map((p) => {
                const s = status(p);
                const field = FIX_FIELD[p.fg];
                return (
                  <li key={p.id} className="px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                      <span className="min-w-0">{p.label}</span>
                      <span className="tabular text-label">
                        {p.ratio.toFixed(2)}:1 <span className="text-muted-foreground">(needs {p.min}:1)</span>{" "}
                        <span className={cn("font-medium", s.tone)}>{s.text}</span>
                      </span>
                    </div>
                    {!p.pass && p.suggestion ? (
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-label text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="inline-block size-3.5 rounded-sm shadow-border-base"
                          style={{ background: isHexColor(p.suggestion) ? p.suggestion : "transparent" }}
                        />
                        <span>
                          Nearest colour that passes: <span className="font-mono text-foreground">{p.suggestion}</span>
                        </span>
                        {field ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => setColor(field, keepAlpha(p.suggestion!, colors[field]))}
                          >
                            Use it for {QUICK_FIELDS.find((f) => f.key === field)!.label.toLowerCase()}
                          </Button>
                        ) : null}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="border-t px-5 py-3 max-sm:px-4">
          {error ? (
            <p role="alert" className="mb-2 text-label text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="tabular mr-auto text-label text-muted-foreground">
              {saved ? "Saved" : ""}
            </p>
            {savedId ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void remove()}
                  disabled={saving}
                  aria-describedby={confirmDelete ? `${uid}-confirm` : undefined}
                >
                  {confirmDelete ? "Confirm delete" : "Delete"}
                </Button>
                {confirmDelete ? (
                  <span id={`${uid}-confirm`} className="sr-only">
                    Press again to delete this theme. Anything using it goes back to Egg.
                  </span>
                ) : null}
              </>
            ) : null}
            {savedId && !saving ? (
              <Button type="button" variant="outline" onClick={() => onExport({ name, scheme, tokens })}>
                Export
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              {saved ? "Close" : "Cancel"}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving} aria-busy={saving || undefined}>
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
