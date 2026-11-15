# Public content changes

## Security page

Added, each checked against the code:
- Browser protection: sign-in return path check, cross-site write refusal, security headers.
- Rate and size limits, as tables. Numbers are tested in security-facts.test.ts.
- GitHub webhook: signature, one-hour replay guard, body cap. Deploy hook size cap.
- Builds: sandbox limits, safe variable names, link checks.
- The .env refusal on the Files page, including through links.
- Host key pinning in full, and what happens when the key changes.
- Token revoke and server disconnect now close open terminals. Multi-line secrets are masked.
- What is not covered: the known gaps from the audits.

Removed:
- The older-version marker note, which was history.
- The "servers connected before these defaults" note, which could not be verified.
- Disconnect text left Accounts and now sits once, beside removal.

## Stats page

Added: rounding rules as a list, what is and is not read, a link to Security, the part-day note.

Removed: the hour-of-day strip, which added little beyond the weekday chart.

Fixed: the claim that every bucket follows the under-10 rule (a day with none shows 0). "Nest Deploy" became "Egg".
