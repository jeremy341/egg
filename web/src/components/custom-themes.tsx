"use client";

import { useId, useRef, useState } from "react";
import { ThemeEditor, blankDraft, type ThemeDraft } from "@/components/theme-editor";
import { Button } from "@/components/ui/button";
import {
  CUSTOM_THEME_LIMIT,
  THEME_FILE_MAX_BYTES,
  parseThemeFile,
  themeFileName,
  themeFileText,
  type CustomThemeView,
} from "@/lib/custom-theme";
import { isHexColor } from "@/lib/theme-color";
import { VSCODE_FILE_MAX_BYTES, describeDefaults, describeImport, importVsCodeTheme } from "@/lib/vscode-theme";

/** A theme file download. The file holds the name, scheme and colours, nothing about the person. */
export function downloadTheme(theme: ThemeDraft) {
  const blob = new Blob([themeFileText({ name: theme.name, scheme: theme.scheme, tokens: theme.tokens })], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = themeFileName(theme.name);
  link.click();
  URL.revokeObjectURL(url);
}

const dot = (color: string) => (isHexColor(color) ? color : "transparent");

/**
 * Settings > Appearance > Your themes: the custom themes with Edit and Export,
 * a New theme button that opens the editor, and Import for a theme file. The
 * themes also appear in the colour theme picker above (SettingsForm).
 */
export function CustomThemesSection({
  themes,
  onSaved,
  onDeleted,
}: {
  themes: readonly CustomThemeView[];
  onSaved: (theme: CustomThemeView, created: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const vsFileRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<{ draft: ThemeDraft; key: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // What a VS Code import found: where the colours came from, which are defaults, and what is left out.
  const [vsNotes, setVsNotes] = useState<string[]>([]);
  const atLimit = themes.length >= CUSTOM_THEME_LIMIT;

  function open(draft: ThemeDraft) {
    setProblem(null);
    setEditor((e) => ({ draft, key: (e?.key ?? 0) + 1 }));
  }

  async function importFile(file: File | undefined) {
    setProblem(null);
    setNote("");
    setVsNotes([]);
    if (!file) return;
    if (file.size > THEME_FILE_MAX_BYTES) {
      setProblem("That file is too large for a theme (8 KB at most).");
      return;
    }
    const result = parseThemeFile(await file.text(), file.size);
    if (!result.ok) {
      setProblem(`Could not import that file. ${result.error}`);
      return;
    }
    setNote("Imported. Check the preview, then save.");
    open({ name: result.value.name, scheme: result.value.scheme, tokens: result.value.tokens });
  }

  async function importVsCodeFile(file: File | undefined) {
    setProblem(null);
    setNote("");
    setVsNotes([]);
    if (!file) return;
    if (file.size > VSCODE_FILE_MAX_BYTES) {
      setProblem("That file is too large for a VS Code theme (256 KB at most).");
      return;
    }
    // The file is read as text and parsed as data. Nothing in it is run.
    const result = importVsCodeTheme(await file.text(), file.size);
    if (!result.ok) {
      setProblem(`Could not import that file. ${result.error}`);
      return;
    }
    const { report } = result;
    setVsNotes(
      [
        describeImport(report),
        describeDefaults(report),
        report.schemeFrom === "background" ? "The file has no type, so we chose light or dark from its background colour." : null,
        report.blended.length > 0 ? "Colours with transparency were laid over the page colour." : null,
        "Check the preview and the contrast results, then save.",
      ].filter((line): line is string => line !== null)
    );
    open({ name: result.value.name, scheme: result.value.scheme, tokens: result.value.tokens });
  }

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 font-medium tracking-[-0.02em]">Your themes</legend>
      <p className="mb-3 max-w-[60ch] text-label text-muted-foreground">
        Build your own from eight colours. They are private to your account and appear in the picker above.{" "}
        {themes.length} of {CUSTOM_THEME_LIMIT} used.
      </p>

      {themes.length > 0 ? (
        <ul className="mb-3 divide-y rounded-md shadow-border-base sm:max-w-[640px]">
          {themes.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span
                aria-hidden="true"
                className="flex h-6 w-10 shrink-0 items-end gap-0.5 rounded-[4px] p-0.5 shadow-border-base"
                style={{ background: dot(t.tokens["ds-background-200"]) }}
              >
                <span className="h-full flex-1 rounded-[2px]" style={{ background: dot(t.tokens["ds-background-100"]) }} />
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: dot(t.tokens.primary) }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.name}</span>
                <span className="block text-caption text-muted-foreground">{t.scheme === "dark" ? "Dark" : "Light"}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Edit ${t.name}`}
                onClick={() => open({ id: t.id, name: t.name, scheme: t.scheme, tokens: t.tokens })}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Export ${t.name}`}
                onClick={() => {
                  downloadTheme(t);
                  setNote(`Exported ${t.name}.`);
                }}
              >
                Export
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={atLimit} onClick={() => open(blankDraft())}>
          New theme
        </Button>
        <Button type="button" variant="outline" disabled={atLimit} onClick={() => fileRef.current?.click()}>
          Import theme
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={atLimit}
          aria-describedby={`${uid}-vs-hint`}
          onClick={() => vsFileRef.current?.click()}
        >
          Import a VS Code theme
        </Button>
        <input
          ref={fileRef}
          id={`${uid}-file`}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Theme file to import"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void importFile(file);
          }}
        />
        <input
          ref={vsFileRef}
          id={`${uid}-vs-file`}
          type="file"
          accept="application/json,.json,.jsonc"
          className="sr-only"
          tabIndex={-1}
          aria-label="VS Code theme file to import"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void importVsCodeFile(file);
          }}
        />
      </div>
      <p id={`${uid}-vs-hint`} className="mt-2 max-w-[60ch] text-label text-muted-foreground">
        Import a VS Code theme file (.json). Egg uses fewer colours than VS Code, so some parts of a VS Code theme will look different.
        Syntax colours are not used.
      </p>
      {atLimit ? (
        <p className="mt-2 text-label text-muted-foreground">You have {CUSTOM_THEME_LIMIT} themes. Delete one to add another.</p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-2 max-w-[60ch] text-label text-destructive">
          {problem}
        </p>
      ) : null}
      <div role="status" className="mt-2 max-w-[60ch] text-label text-muted-foreground">
        {note}
        {vsNotes.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {editor ? (
        <ThemeEditor
          key={editor.key}
          draft={editor.draft}
          atLimit={atLimit}
          onClose={() => setEditor(null)}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onExport={downloadTheme}
        />
      ) : null}
    </fieldset>
  );
}
