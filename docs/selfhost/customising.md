# Customising Egg

Everything here is a change to a file in `web/`. Find the places by the file, variable or quoted text below rather than by line number: lines move as the code changes. Restart Egg (`pnpm egg start`), or run `pnpm build` again, after a change.

Back to the [self-hosting guide](README.md).

## The brand name

The name is not one setting. It is written out in the places below, and each one currently says "Egg".

| What you see | File | Text to change |
| --- | --- | --- |
| Browser tab title and its template | `web/src/app/layout.tsx` | the `metadata.title` default `"Egg"` and template `"%s \| Egg"` |
| Sign-in page heading, sentence and logo label | `web/src/app/(auth)/login/page.tsx` | `Log in to Egg`, `It doesn't give Egg access to your server` and `aria-label="Egg, home"` |
| Sidebar logo label | `web/src/components/sidebar.tsx` | `aria-label="Egg home"` |
| Top bar logo label | `web/src/components/top-bar.tsx` | `aria-label="Egg home"` |
| Setup flow logo label | `web/src/app/(flow)/layout.tsx` | `aria-label="Egg home"` |
| "Page not found" page | `web/src/app/not-found.tsx` | `aria-label="Egg, home"` and the visible name |
| Public header name | `web/src/app/(marketing)/layout.tsx` | `aria-label="Egg, home"` and the visible `Egg` link text |
| Public footer name and status link | `web/src/app/(marketing)/layout.tsx` and `web/src/components/marketing/footer-switch.tsx` | `Egg` and the `Nest status` link label |
| Mark's accessible title | `web/src/components/egg-mark.tsx` | `<title>Egg</title>` |

Most of the app's sentences, such as "Egg builds it and runs it on your Nest server", also contain the name. To find all of them, run this from the repo root:

```bash
grep -rn "Egg" web/src --include=*.ts --include=*.tsx
```

About 60 files match. A project-wide search and replace of `Egg` is safe for visible text, but skip file names, class names, the `# egg:managed` comment and the `Egg: ` description prefix that Egg writes into service files on a container, and the `.egg-managed` marker file in project folders, because Egg uses those markers to recognise what it made. Re-run `pnpm test` afterwards, because a few tests check exact wording.

The marketing pages and the docs pages have their own copy and are separate from the app. Leave them alone if you only use the app privately.

## Colours

Colours are CSS variables in `web/src/app/globals.css`. The `:root` block is Egg Light and the `.dark` block is Egg Dark, the two defaults. Every other built-in theme is a `[data-theme-preset="<id>"]` block in the same file (dark themes also carry the `.dark` class). Change a variable in every theme block where it appears, or the themes will disagree.

There is no separate accent-colour chooser any more. On the Settings page each person picks a **light theme** and a **dark theme**, or turns on **Match my device** to use both. The list comes from `PRESETS` in `web/src/lib/preferences.ts`; `egg-light` and `egg-dark` are the defaults and the boot script sets no `data-theme-preset` attribute for them. Old accent cookie values are still recognised and mapped through `LEGACY_ACCENT_PRESET`, but they are never written again.

People can also build their own colour theme in the Settings theme editor. A custom theme starts from eight colours: Page background, Card surface, Border, Text, Muted text, Primary, Link and Danger. The remaining tokens (grey steps, tints, focus ring, hover, status colours and text on buttons) are derived from those eight, with a contrast check. Custom themes are saved per account (up to 20, `CUSTOM_THEME_LIMIT`), can be exported and imported as JSON (VS Code theme files can also be imported), and are selected as `custom:<id>`. The token list lives in `web/src/lib/custom-theme.ts`; add new tokens at the end of `THEME_TOKENS`, never in the middle, because the cookie and the `--ct-<n>` variables use their position.

### What everyone starts with

To change the default colours for people who have not picked a theme, edit the variables by name in the `:root` and `.dark` blocks of `globals.css`:

| Variable | Used for |
| --- | --- |
| `--brand` | The accent: focus rings, links, selection and the current-production pill |
| `--brand-foreground` | Text on top of the accent |
| `--brand-soft` | A pale background tint |
| `--brand-text` | Accent-coloured text |
| `--background`, `--foreground` | Page background and main text |
| `--primary`, `--primary-foreground` | Primary buttons and their text |
| `--destructive`, `--success` | Delete/error and success states |
| `--status-ready` | The "Ready" dot |

The values may point at a `--ds-*` scale in the same file. Change a scale to move a whole family of greys or reds at once, or replace the `var(...)` with a colour of your own to change one use. Check that `--brand-text` is readable on `--brand-soft`, and that `--brand-foreground` is readable on `--brand`.

To add, rename or remove a built-in theme, change both sides: its `[data-theme-preset="<id>"]` block in `globals.css` and its `PRESETS` entry in `web/src/lib/preferences.ts` (id, label, scheme and swatch). Keep the id and the selector in step, and keep one light and one dark default available for "Match my device".

## The build memory and CPU limits

Builds run on the Nest container of each project, and each one gets a memory cap and a CPU cap. Each server stores its own two values. You change them on that server's Container page, in **Build memory (MB)** and **Build CPU limit (cores)**. You do not need to edit code for that.

The code also holds a default for each, in `web/src/lib/build-memory.ts`:

- `DEFAULT_CONTAINER_BUILD_MEMORY_MB = 512`, the memory a new server starts with and what the "Use 512 MB" button restores.
- `BUILD_STEP_FLOOR_MB = 1024`, the least a project with a build step gets while it builds, if the container has room for it.
- `DEFAULT_BUILD_CPUS = 2`, the CPU default.

Changing these numbers does **not** change what an existing server uses. To change what a server uses, set it on the Container page. A server that still had the old 1024 MB default saved was lowered to 512 MB by a migration. A value you saved yourself was kept. The 1024 MB floor for build steps is applied when a build starts and does not change the saved value.

A project with a build step (a build command, or a build script such as `next build`) gets at least 1024 MB while it builds, as long as the container's memory minus 512 MB is at least 1024 MB. Installs and plain apps use the setting. A build never gets more than the container's memory minus `CONTAINER_RESERVE_MB` (512 MB), which stays free for the app. If that leaves less than `MIN_CONTAINER_CAP_MB` (256 MB, in `web/src/server/deploy/container-build.ts`), the build does not start. The smallest setting is `MIN_BUILD_MEMORY_MB = 512` and the top of the range when a server reports no memory is `FALLBACK_MAX_BUILD_MEMORY_MB = 8192`. The smallest CPU limit is `MIN_BUILD_CPUS = 0.5` and the step is `BUILD_CPU_STEP = 0.25`.

## Ports

Egg uses three ports, and each one has to be changed in two places so they agree.

| Port | Default | Change it | Then also set |
| --- | --- | --- | --- |
| The website | 3000 | Set `APP_URL=http://localhost:4000` in `web/.env.local`. `pnpm egg start` and the start-on-login service listen on that port. Or `PORT=4000 pnpm start`, or `pnpm dev --port 4000` | `APP_URL` must match whichever you use |
| The stand-in server (`pnpm fake-nest`) | 2222 | `FAKE_NEST_PORT=2223 pnpm fake-nest` (the `FAKE_NEST_PORT` variable in `web/scripts/fake-nest.ts`) | `NEST_PORT=2223` in `web/.env.local` |
| The SSH port Egg connects to | 22 | `NEST_PORT` in `web/.env.local` (the `NEST_PORT` field in `web/src/server/config.ts`) | Only change it with `fake-nest` |

On Windows PowerShell, set a variable for one command with `$env:PORT = "4000"; pnpm start`. If you used `pnpm run service:install`, run it again after a port change so the service file has the new port.

If you change the website port and leave `APP_URL` as it was, sign-in redirects and the same-origin check on writes will point at the old port and sign-in will fail. With `LOCAL_MODE=1`, `APP_URL` must still be `localhost`, `127.0.0.1` or `[::1]`, so `http://localhost:4000` is fine.

On a server run with Docker Compose, the website port is fixed at 3000 inside the network and only Caddy is published (80 and 443). Do not change it there.

Deployed apps listen on their own ports on your Nest container, and branch previews use ports 20000 to 29999 there. Those are not Egg settings. You choose an app's port in the project, and Egg picks a preview's port.
