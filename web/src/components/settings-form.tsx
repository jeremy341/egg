"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { applyAppearance, savePreferences, storeAppearance } from "@/components/appearance";
import { Segmented } from "@/components/segmented";
import { Card } from "@/components/settings-ui";
import { CharacterAvatar } from "@/components/ui/character-avatar";
import { Input } from "@/components/ui/input";
import { ANALYTICS_FEATURES, ANALYTICS_FEATURE_LABELS, type AnalyticsFeatureKey } from "@/lib/analytics-defaults";
import {
  ACCENTS,
  ACCENT_LABELS,
  ACCENT_SWATCH,
  AVATARS,
  isValidBranchName,
  type Density,
  type Motion,
  type Preferences,
  type Theme,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

type Group = "profile" | "appearance" | "deploys" | "analytics" | "preferences";
type Message = { group: Group; tone: "saved" | "error"; text: string };

const NAME_MAX = 40;

/** One labelled control with an optional hint. Left aligned, label above. */
function Field({
  label,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  hintId?: string;
  error?: string | null;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block font-medium tracking-[-0.02em]">
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="mt-1.5 text-label text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-1.5 max-w-[60ch] text-label text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A group of related controls under one legend. */
function Fieldset({ legend, hint, hintId, children }: { legend: string; hint?: string; hintId?: string; children: React.ReactNode }) {
  return (
    <fieldset aria-describedby={hint ? hintId : undefined} className="min-w-0">
      <legend className="mb-1.5 font-medium tracking-[-0.02em]">{legend}</legend>
      {children}
      {hint ? (
        <p id={hintId} className="mt-1.5 max-w-[60ch] text-label text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Native radios (so the arrow keys and the group name work) drawn as tiles. */
const tile =
  "flex h-full flex-col items-start gap-2 rounded-md bg-background p-2.5 max-sm:p-2 shadow-border-base transition-[box-shadow] duration-(--dur-fast) hover:shadow-border-hover peer-checked:shadow-[0_0_0_2px_var(--foreground)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ds-focus-color)] max-sm:min-h-10";

export function SettingsForm({
  initial,
  hackClubName,
}: {
  initial: Preferences;
  /** Shown as the fallback when no display name is set. */
  hackClubName: string;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [, startTransition] = useTransition();
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [message, setMessage] = useState<Message | null>(null);
  const [nameDraft, setNameDraft] = useState(initial.displayName ?? "");
  const [branchDraft, setBranchDraft] = useState(initial.defaultBranch ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const saving = useRef(0);
  const ids = useId();

  /** Save one or more fields. The look is applied before the answer comes back. */
  async function change(group: Group, patch: Partial<Preferences>, opts: { refresh?: boolean } = {}) {
    const before = prefs;
    setPrefs((p) => ({ ...p, ...patch }));
    if (patch.theme || patch.accent || patch.density || patch.reducedMotion) {
      const appearance = storeAppearance({
        ...(patch.theme && { theme: patch.theme }),
        ...(patch.accent && { accent: patch.accent }),
        ...(patch.density && { density: patch.density }),
        ...(patch.reducedMotion && { reducedMotion: patch.reducedMotion }),
      });
      applyAppearance(appearance);
      if (patch.theme) setTheme(patch.theme);
    }
    const ticket = ++saving.current;
    try {
      const saved = await savePreferences(patch);
      if (ticket === saving.current) {
        setPrefs((p) => ({ ...p, ...saved }));
        const at = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setMessage({ group, tone: "saved", text: `Saved at ${at}` });
      }
      if (opts.refresh) startTransition(() => router.refresh());
      return true;
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not save";
      // Appearance already changed on this device; the account keeps the old value.
      const accountOnly =
        patch.displayName !== undefined ||
        patch.defaultBranch !== undefined ||
        patch.avatar !== undefined ||
        patch.analyticsDefaults !== undefined;
      setMessage({
        group,
        tone: "error",
        text: accountOnly
          ? `Not saved. ${text}`
          : `Not saved to your account. ${text} The change still applies on this device.`,
      });
      if (accountOnly) {
        setPrefs((p) => ({
          ...p,
          displayName: before.displayName,
          defaultBranch: before.defaultBranch,
          avatar: before.avatar,
          analyticsDefaults: before.analyticsDefaults,
        }));
      }
      return false;
    }
  }

  async function commitName() {
    const next = nameDraft.trim();
    if (next.length > NAME_MAX) {
      setNameError(`Use ${NAME_MAX} characters or fewer.`);
      return;
    }
    setNameError(null);
    if (next === (prefs.displayName ?? "")) return;
    const ok = await change("profile", { displayName: next === "" ? null : next }, { refresh: true });
    if (!ok) setNameError("That name was not accepted.");
  }

  async function commitBranch() {
    const next = branchDraft.trim();
    if (next !== "" && !isValidBranchName(next)) {
      setBranchError("That is not a valid git branch name. Use letters, digits, / . _ - and no spaces.");
      return;
    }
    setBranchError(null);
    if (next === (prefs.defaultBranch ?? "")) return;
    const ok = await change("deploys", { defaultBranch: next === "" ? null : next });
    if (!ok) setBranchError("That branch name was not accepted.");
  }

  const shown = prefs.displayName?.trim() || hackClubName;

  /** The footer of a group: a quiet hint, and a live region for the result. */
  const footer = (group: Group) => (
    <>
      <p className="text-label text-muted-foreground">Changes save as you make them.</p>
      <p
        role="status"
        className={cn(
          "tabular text-label",
          message?.group === group && message.tone === "error" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {message?.group === group ? message.text : ""}
      </p>
    </>
  );

  const nameId = `${ids}-name`;
  const branchId = `${ids}-branch`;

  return (
    <div className="space-y-6">
      <Card
        id="profile-heading"
        title="Profile"
        description={`Shown in the menu and on your account page. Not used in any address, and two people can share a name. Without one, Egg shows your Hack Club name (${hackClubName}).`}
        footer={footer("profile")}
      >
        <div className="space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commitName();
            }}
          >
            <Field
              label="Display name"
              htmlFor={nameId}
              hint={`Up to ${NAME_MAX} characters. Leave it empty to use your Hack Club name.`}
              hintId={`${nameId}-hint`}
              error={nameError}
              errorId={`${nameId}-error`}
            >
              <Input
                id={nameId}
                name="displayName"
                value={nameDraft}
                maxLength={NAME_MAX * 2}
                autoComplete="nickname"
                placeholder={hackClubName}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? `${nameId}-error ${nameId}-hint` : `${nameId}-hint`}
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  if (nameError) setNameError(null);
                }}
                onBlur={() => void commitName()}
                className="sm:max-w-[360px]"
              />
            </Field>
          </form>

          <Fieldset legend="Character" hint="A small pixel character beside your name. There are no uploads." hintId={`${ids}-char-hint`}>
            <div className="grid grid-cols-4 gap-2 sm:max-w-[420px]">
              {AVATARS.map((a) => (
                <label key={a.id} className="relative block min-w-0 cursor-pointer">
                  <input
                    type="radio"
                    name="avatar"
                    value={a.id}
                    checked={prefs.avatar === a.id}
                    onChange={() => void change("profile", { avatar: a.id }, { refresh: true })}
                    className="peer sr-only"
                  />
                  <span className={tile}>
                    <CharacterAvatar id={a.id} size={32} />
                    <span className="max-w-full text-label max-sm:text-[12px]">{a.label}</span>
                  </span>
                </label>
              ))}
            </div>
          </Fieldset>

          <p className="flex items-center gap-2 text-label text-muted-foreground">
            <CharacterAvatar id={prefs.avatar} size={20} />
            <span>
              You will appear as <span className="font-medium text-foreground">{shown}</span>.
            </span>
          </p>
        </div>
      </Card>

      <Card
        id="appearance-heading"
        title="Appearance"
        description="Theme, colour and spacing. They apply straight away and follow you to other devices."
        footer={footer("appearance")}
      >
        <div className="space-y-6">
          <Fieldset legend="Theme">
            <Segmented<Theme>
              label="Theme"
              value={prefs.theme}
              onChange={(theme) => void change("appearance", { theme })}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
          </Fieldset>

          <Fieldset legend="Accent colour" hint="Colours buttons, links and the focus ring. Text on them keeps at least 4.5:1 contrast." hintId={`${ids}-accent-hint`}>
            <div className="grid grid-cols-2 gap-2 sm:max-w-[420px] sm:grid-cols-4">
              {ACCENTS.map((a) => (
                <label key={a} className="relative block min-w-0 cursor-pointer">
                  <input
                    type="radio"
                    name="accent"
                    value={a}
                    checked={prefs.accent === a}
                    onChange={() => void change("appearance", { accent: a })}
                    className="peer sr-only"
                  />
                  <span className={cn(tile, "flex-row items-center")}>
                    <span
                      aria-hidden="true"
                      className="size-4 shrink-0 rounded-[3px] shadow-border-base"
                      style={{ background: ACCENT_SWATCH[a] }}
                    />
                    <span className="truncate text-label">{ACCENT_LABELS[a]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Fieldset>

          <Fieldset legend="Density" hint="Compact tightens the project and deployment lists." hintId={`${ids}-density-hint`}>
            <Segmented<Density>
              label="Density"
              value={prefs.density}
              onChange={(density) => void change("appearance", { density })}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </Fieldset>
        </div>
      </Card>

      <Card
        id="deploys-heading"
        title="Deploys"
        description="Defaults for new projects. They never change a project that already exists."
        footer={footer("deploys")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void commitBranch();
          }}
        >
          <Field
            label="Default branch"
            htmlFor={branchId}
            hint="Pre-filled as the production branch when you add a project from a repository URL. Repositories you pick from GitHub keep their own default branch."
            hintId={`${branchId}-hint`}
            error={branchError}
            errorId={`${branchId}-error`}
          >
            <Input
              id={branchId}
              name="defaultBranch"
              value={branchDraft}
              maxLength={120}
              placeholder="main"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              aria-invalid={branchError ? true : undefined}
              aria-describedby={branchError ? `${branchId}-error ${branchId}-hint` : `${branchId}-hint`}
              onChange={(e) => {
                setBranchDraft(e.target.value);
                if (branchError) setBranchError(null);
              }}
              onBlur={() => void commitBranch()}
              className="font-mono sm:max-w-[360px]"
            />
          </Field>
        </form>
      </Card>

      <Card
        id="analytics-heading"
        title="Analytics defaults"
        description="The features a project starts with when you first turn analytics on for it. Every one is off unless you switch it on here. Projects that already have analytics are not changed, and each project can still change its own."
        footer={footer("analytics")}
      >
        <fieldset className="min-w-0">
          <legend className="sr-only">Analytics features a new project starts with</legend>
          <div className="divide-y">
            {ANALYTICS_FEATURES.map((key: AnalyticsFeatureKey) => {
              const info = ANALYTICS_FEATURE_LABELS[key];
              const id = `${ids}-analytics-${key}`;
              return (
                <label key={key} htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
                  <input
                    id={id}
                    type="checkbox"
                    name={`analytics-${key}`}
                    className="mt-1"
                    checked={prefs.analyticsDefaults[key] === true}
                    onChange={(e) =>
                      void change("analytics", { analyticsDefaults: { ...prefs.analyticsDefaults, [key]: e.target.checked } })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block">{info.title}</span>
                    <span className="block max-w-[60ch] text-label text-muted-foreground">{info.sentence}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <Card
        id="preferences-heading"
        title="Preferences"
        description="How much the interface moves."
        footer={footer("preferences")}
      >
        <Fieldset
          legend="Motion"
          hint="Device follows your system setting. Reduce turns animation off. Allow keeps transitions even if your device asks for less; some entrance effects stay off."
          hintId={`${ids}-motion-hint`}
        >
          <Segmented<Motion>
            label="Motion"
            value={prefs.reducedMotion}
            onChange={(reducedMotion) => void change("preferences", { reducedMotion })}
            options={[
              { value: "system", label: "Device" },
              { value: "reduce", label: "Reduce" },
              { value: "no-preference", label: "Allow" },
            ]}
          />
        </Fieldset>
      </Card>
    </div>
  );
}
