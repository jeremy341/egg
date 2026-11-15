# Customising Egg

Everything here is a change to a file in `web/`. Line numbers are correct for the commit this guide was written against; if a line has moved, search for the quoted text. Restart `pnpm dev`, or run `pnpm build` again, after a change.

Back to the [self-hosting guide](README.md).

## The brand name

The name is not one setting. It is written out in the places below, and each one currently says "Egg".

| What you see | File and line | Text to change |
| --- | --- | --- |
| Browser tab title and its template | `web/src/app/layout.tsx:20` and `:21` | `"Egg"` and `"%s \| Egg"` |
| Sign-in page heading and sentence | `web/src/app/(auth)/login/page.tsx:101` and `:144` | `Log in to Egg` and `It doesn't give Egg access to your server` |
| Sign-in page logo label | `web/src/app/(auth)/login/page.tsx:91` | `aria-label="Egg, home"` |
| Sidebar logo label | `web/src/components/sidebar.tsx:55` | `aria-label="Egg home"` |
| Top bar logo label | `web/src/components/top-bar.tsx:56` | `aria-label="Egg home"` |
| Setup flow logo label | `web/src/app/(flow)/layout.tsx:31` | `aria-label="Egg home"` |
| "Page not found" page | `web/src/app/not-found.tsx:20` and `:22` | label and the visible name |
| Public header name | `web/src/app/(marketing)/layout.tsx:48` and `:50` | `Egg` |
| Public footer name | `web/src/app/(marketing)/layout.tsx:82` and `web/src/components/marketing/footer-switch.tsx:22` | `Egg` |
| Mark's accessible title | `web/src/components/egg-mark.tsx:35` | `<title>Egg</title>` |

Most of the app's sentences, such as "Egg builds it and runs it on your Nest server", also contain the name. To find all of them, run this from the repo root:

```bash
grep -rn "Egg" web/src --include=*.ts --include=*.tsx
```

About 60 files match. A project-wide search and replace of `Egg` is safe for visible text, but skip file names, class names, the `# egg:managed` comment and the `Egg: ` description prefix that Egg writes into service files on a container, and the `.egg-managed` marker file in project folders, because Egg uses those markers to recognise what it made. Re-run `pnpm test` afterwards, because a few tests check exact wording.

The marketing pages and the docs pages have their own copy and are separate from the app. Leave them alone if you only use the app privately.

## Colours

Colours are CSS variables in `web/src/app/globals.css`. Light mode is the `:root` block, which starts at line 157. Dark mode is the `.dark` block, which starts at line 302. A colour you change in one needs changing in the other, or the two modes will disagree.

### The accent colour

The accent is used for focus rings, links, selection and the current-production pill.

| Variable | Light line | Dark line | Used for |
| --- | --- | --- | --- |
| `--brand` | 270 | 361 | The accent itself. Currently `var(--ds-blue-700)`. |
| `--brand-foreground` | 271 | 362 | Text on top of the accent. Currently `#ffffff`. |
| `--brand-soft` | 272 | 363 | A pale background tint. Currently `var(--ds-blue-100)`. |
| `--brand-text` | 273 | 364 | Accent-coloured text. Currently `var(--ds-blue-900)`. |

The quickest change is to give `--brand` a value of your own, for example `--brand: hsl(142 70% 38);`, and adjust `--brand-soft` and `--brand-text` to match. The blue scale they point to is defined at lines 204 to 206 (light) and 323 to 325 (dark), if you would rather change the scale.

Check that `--brand-text` is still readable on `--brand-soft`, and that white text is readable on `--brand`.

### Other colours

| Variable | Light line | What it colours |
| --- | --- | --- |
| `--background` | 239 | Page background |
| `--foreground` | 241 | Main text |
| `--primary` | 246 | Primary buttons |
| `--destructive` | 256 | Delete and error actions |
| `--success` | 262 | Success states |
| `--status-ready` | 265 | The "Ready" dot |

Most of these point at a `--ds-*` scale in the same file. Change the scale to move a whole family of greys or reds at once, or replace the `var(...)` with a colour of your own to change one use.

## The default build memory

Builds in the Docker sandbox get a memory limit. The default is one number:

- `web/src/lib/build-memory.ts:7`: `export const DEFAULT_BUILD_MEMORY_MB = 2048;`

The smallest allowed value is on line 8 (`MIN_BUILD_MEMORY_MB = 512`) and the top of the range when a server reports no memory is on line 10 (`FALLBACK_MAX_BUILD_MEMORY_MB = 8192`). Keep the default between those. This default applies to a server until you set its own value on the Container page. It does not apply to `BUILD_RUNNER=local`, which has no limit.

## Ports

Egg uses three ports, and each one has to be changed in two places so they agree.

| Port | Default | Change it | Then also set |
| --- | --- | --- | --- |
| The website | 3000 | `PORT=4000 pnpm start`, or `pnpm dev --port 4000` | `APP_URL=http://localhost:4000` in `web/.env.local` |
| The stand-in server (`pnpm fake-nest`) | 2222 | `FAKE_NEST_PORT=2223 pnpm fake-nest` (read at `web/scripts/fake-nest.ts:30`) | `NEST_PORT=2223` in `web/.env.local` |
| The SSH port Egg connects to | 22 | `NEST_PORT` in `web/.env.local` (defined in `web/src/server/config.ts`) | Only change it with `fake-nest` |

On Windows PowerShell, set a variable for one command with `$env:PORT = "4000"; pnpm start`.

If you change the website port and leave `APP_URL` as it was, sign-in redirects and the same-origin check on writes will point at the old port and sign-in will fail. With `LOCAL_MODE=1`, `APP_URL` must still be `localhost`, `127.0.0.1` or `[::1]`, so `http://localhost:4000` is fine.

Deployed apps use their own ports on the server, and branch previews use ports 20000 to 29999. Those are not Egg settings.
