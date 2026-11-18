"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useTheme } from "next-themes";
import { api } from "@/components/api";
import {
  applyAppearance,
  currentCustomThemes,
  deviceIsDark,
  forgetCustomTheme,
  rememberCustomThemes,
  savePreferences,
  storeAppearance,
} from "@/components/appearance";
import { CustomThemesSection } from "@/components/custom-themes";
import { Segmented } from "@/components/segmented";
import { Card } from "@/components/settings-ui";
import { CharacterAvatar } from "@/components/ui/character-avatar";
import { Input } from "@/components/ui/input";
import { ANALYTICS_FEATURES, ANALYTICS_FEATURE_LABELS, type AnalyticsFeatureKey } from "@/lib/analytics-defaults";
import type { CustomThemeView } from "@/lib/custom-theme";
import {
  AVATARS,
  PRESETS,
  effectivePreset,
  isValidBranchName,
  themeMode,
  type Appearance,
  type DarkPreset,
  type Density,
  type LightPreset,
  type Motion,
  type PresetDef,
  type Preferences,
  type Preset,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

type Group = "profile" | "appearance" | "deploys" | "analytics" | "preferences";
type Message = { group: Group; tone: "saved" | "error"; text: string };

const NAME_MAX = 40;

/** One small heading for a group of cards. */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-6">
      <h2 id={id} className="border-b pb-2 text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A native disclosure for the rarely used options of a group. */
function Advanced({ label = "Advanced", children }: { label?: string; children: React.ReactNode }) {
  return (
    <details className="disclosure">
      <summary className="touch-target -mx-1 w-fit items-center gap-1.5 rounded-sm px-1 py-1.5 text-label font-medium max-sm:min-h-10">
        <CaretRightIcon aria-hidden="true" className="disclosure-caret size-4" />
        {label}
      </summary>
      <div className="mt-3 space-y-6">{children}</div>
    </details>
  );
}

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

const LIGHT_PRESETS = PRESETS.filter((p) => p.scheme === "light");
const DARK_PRESETS = PRESETS.filter((p) => p.scheme === "dark");
const APPEARANCE_KEYS = ["matchDevice", "lightPreset", "darkPreset", "preset", "density", "reducedMotion"] as const;
/** Fields saved to the account. A failed save puts back only the ones it changed. */
const ACCOUNT_KEYS = ["displayName", "defaultBranch", "avatar", "analyticsDefaults"] as const;

/** A custom theme as a picker tile: the same four colours a built-in theme shows. */
function customDef(t: CustomThemeView): PresetDef {
  return {
    id: t.preset,
    label: t.name,
    scheme: t.scheme,
    swatch: { page: t.tokens["ds-background-200"], surface: t.tokens["ds-background-100"], text: t.tokens.foreground, primary: t.tokens.primary },
  };
}
const TILE_GRID = "grid grid-cols-2 gap-2 sm:max-w-[640px] sm:grid-cols-4";

/** One theme as a radio tile: the four-colour preview, its name, and Light or Dark. */
function ThemeTile({
  name,
  preset,
  checked,
  onSelect,
}: {
  name: string;
  preset: PresetDef;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="touch-target relative block min-w-0 cursor-pointer">
      <input type="radio" name={name} value={preset.id} checked={checked} onChange={onSelect} className="peer sr-only" />
      <span className={tile}>
        <span
          aria-hidden="true"
          className="flex h-9 w-full items-end gap-1 rounded-[4px] p-1 shadow-border-base"
          style={{ background: preset.swatch.page }}
        >
          <span className="h-full flex-1 rounded-[2px]" style={{ background: preset.swatch.surface }} />
          <span className="size-2 shrink-0 rounded-full" style={{ background: preset.swatch.text }} />
          <span className="size-2 shrink-0 rounded-full" style={{ background: preset.swatch.primary }} />
        </span>
        <span className="flex w-full min-w-0 flex-col">
          <span className="line-clamp-2 text-label font-medium break-words">{preset.label}</span>
          <span className="text-caption text-muted-foreground">{preset.scheme === "dark" ? "Dark" : "Light"}</span>
        </span>
      </span>
    </label>
  );
}

export function SettingsForm({
  initial,
  hackClubName,
  customThemes = [],
}: {
  initial: Preferences;
  /** The person's own colour themes. They sit in the theme picker beside the built-in ones. */
  customThemes?: readonly CustomThemeView[];
  /** Shown as the fallback when no display name is set. */
  hackClubName: string;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [, startTransition] = useTransition();
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [themes, setThemes] = useState<readonly CustomThemeView[]>(customThemes);
  // The page needs the colours of every theme that could be picked, to apply it and to write the cookie.
  useEffect(() => rememberCustomThemes(themes), [themes]);
  const lightList: PresetDef[] = [...LIGHT_PRESETS, ...themes.filter((t) => t.scheme === "light").map(customDef)];
  const darkList: PresetDef[] = [...DARK_PRESETS, ...themes.filter((t) => t.scheme === "dark").map(customDef)];
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
    const look: Partial<Appearance> = {};
    for (const key of APPEARANCE_KEYS) if (patch[key] !== undefined) Object.assign(look, { [key]: patch[key] });
    if (Object.keys(look).length > 0) {
      const appearance = storeAppearance(look);
      applyAppearance(appearance);
      // next-themes puts the light or dark class on the page, and follows the device while matching.
      setTheme(themeMode(appearance, currentCustomThemes()));
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
      const accountKeys = ACCOUNT_KEYS.filter((key) => patch[key] !== undefined);
      const accountOnly = accountKeys.length > 0;
      // A newer save has started since this one. It owns the message and the fields now, so leave them alone.
      if (ticket !== saving.current) return false;
      setMessage({
        group,
        tone: "error",
        text: accountOnly
          ? `Not saved. ${text}`
          : `Not saved to your account. ${text} The change still applies on this device.`,
      });
      if (accountOnly) {
        // Put back only the account fields this request changed, to the value they had before it.
        const restore: Partial<Preferences> = {};
        for (const key of accountKeys) Object.assign(restore, { [key]: before[key] });
        setPrefs((p) => ({ ...p, ...restore }));
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

  /** After a custom theme is saved, changed or deleted: take the choice the account now holds and show it. */
  async function syncChoice() {
    try {
      const { preferences } = await api<{ preferences: Preferences }>("/api/preferences");
      const choice = {
        lightPreset: preferences.lightPreset,
        darkPreset: preferences.darkPreset,
        preset: preferences.preset,
      };
      setPrefs((p) => ({ ...p, ...choice }));
      const appearance = storeAppearance(choice);
      applyAppearance(appearance);
      setTheme(themeMode(appearance, currentCustomThemes()));
    } catch {
      // The page keeps what it shows; the next load takes the account's choice.
    }
  }

  function themeSaved(theme: CustomThemeView, created: boolean) {
    setThemes((list) => (list.some((t) => t.id === theme.id) ? list.map((t) => (t.id === theme.id ? theme : t)) : [...list, theme]));
    rememberCustomThemes([theme]);
    if (created) {
      // A new theme is chosen straight away: in its own slot while matching the device, else as the theme.
      const pick: Partial<Preferences> = prefs.matchDevice
        ? theme.scheme === "light"
          ? { lightPreset: theme.preset }
          : { darkPreset: theme.preset }
        : { preset: theme.preset };
      void change("appearance", pick);
    } else {
      void syncChoice();
    }
  }

  function themeDeleted(id: string) {
    setThemes((list) => list.filter((t) => t.id !== id));
    forgetCustomTheme(`custom:${id}`);
    void syncChoice();
  }

  const shown = prefs.displayName?.trim() || hackClubName;
  /** Turning matching off keeps the theme that is showing now, so the page does not change under the person. */
  function setMatchDevice(on: boolean) {
    void change("appearance", on ? { matchDevice: true } : { matchDevice: false, preset: effectivePreset(prefs, deviceIsDark()) });
  }

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
  const matchId = `${ids}-match`;
  const branchId = `${ids}-branch`;

  return (
    <div className="space-y-8">
      <Section id="identity-group" title="Identity">
      <Card
        id="profile-heading"
        title="Profile"
        description="Shown in the menu and on your account page."
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
              hint={`Up to ${NAME_MAX} characters. Leave it empty to use your Hack Club name (${hackClubName}).`}
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

          <Fieldset legend="Character" hint="A small pixel character beside your name." hintId={`${ids}-char-hint`}>
            <div className="grid grid-cols-4 gap-2 sm:max-w-[420px]">
              {AVATARS.map((a) => (
                <label key={a.id} className="touch-target relative block min-w-0 cursor-pointer">
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
      </Section>

      <Section id="interface-group" title="Interface">
      <Card
        id="appearance-heading"
        title="Appearance"
        description="Applies straight away and follows you to other devices."
        footer={footer("appearance")}
      >
        <div className="space-y-6">
          <div>
            <label htmlFor={matchId} className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
              <input
                id={matchId}
                type="checkbox"
                role="switch"
                name="matchDevice"
                className="mt-1"
                checked={prefs.matchDevice}
                aria-describedby={`${matchId}-hint`}
                onChange={(e) => setMatchDevice(e.target.checked)}
              />
              <span className="min-w-0 font-medium tracking-[-0.02em]">Match my device</span>
            </label>
            <p id={`${matchId}-hint`} className="max-w-[60ch] pl-7 text-label text-muted-foreground">
              Use one theme in light mode and another in dark mode.
            </p>
          </div>

          {prefs.matchDevice ? (
            <>
              <Fieldset legend="Light theme">
                <div className={TILE_GRID}>
                  {lightList.map((p) => (
                    <ThemeTile
                      key={p.id}
                      name="light-theme"
                      preset={p}
                      checked={prefs.lightPreset === p.id}
                      onSelect={() => void change("appearance", { lightPreset: p.id as LightPreset })}
                    />
                  ))}
                </div>
              </Fieldset>
              <Fieldset legend="Dark theme">
                <div className={TILE_GRID}>
                  {darkList.map((p) => (
                    <ThemeTile
                      key={p.id}
                      name="dark-theme"
                      preset={p}
                      checked={prefs.darkPreset === p.id}
                      onSelect={() => void change("appearance", { darkPreset: p.id as DarkPreset })}
                    />
                  ))}
                </div>
              </Fieldset>
            </>
          ) : (
            <Fieldset legend="Colour theme">
              <div className="space-y-4">
                {(
                  [
                    ["light", "Light themes", lightList],
                    ["dark", "Dark themes", darkList],
                  ] as const
                ).map(([key, title, list]) => (
                  <div key={key} role="group" aria-labelledby={`${ids}-group-${key}`}>
                    <p id={`${ids}-group-${key}`} className="mb-1.5 text-label text-muted-foreground">
                      {title}
                    </p>
                    <div className={TILE_GRID}>
                      {list.map((p) => (
                        <ThemeTile
                          key={p.id}
                          name="theme-preset"
                          preset={p}
                          checked={prefs.preset === p.id}
                          onSelect={() => void change("appearance", { preset: p.id as Preset })}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Fieldset>
          )}
          <p className="-mt-3 max-w-[60ch] text-label text-muted-foreground">
            Themes marked &ldquo;Inspired by&rdquo; are not made or endorsed by those projects.
          </p>

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

          <Advanced label="Your own themes">
            <CustomThemesSection themes={themes} onSaved={themeSaved} onDeleted={themeDeleted} />
          </Advanced>
        </div>
      </Card>

      <Card
        id="preferences-heading"
        title="Preferences"
        description="How much the interface moves."
        footer={footer("preferences")}
      >
        <Fieldset
          legend="Motion"
          hint="Device follows your system setting. Reduce turns animation off."
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
      </Section>

      <Section id="defaults-group" title="Defaults for new projects">
      <Card
        id="deploys-heading"
        title="Deploys"
        description="Never changes a project that already exists."
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
            hint="Pre-filled as the production branch when you add a project from a repository URL."
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

      <Advanced>
        <Card
          id="analytics-heading"
          title="Analytics defaults"
          description="The features a new project starts with when you turn analytics on for it; existing projects keep their own."
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
      </Advanced>
      </Section>
    </div>
  );
}
