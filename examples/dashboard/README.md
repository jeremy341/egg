# A static dashboard

`index.html` is one file with no build step. Open it, type your Egg address, paste a token and press Connect. It shows who the token is, your projects with their uptime check and latest deployment, and a 30-day page-view chart for a project.

**Token scopes:** `projects:read`. Add `analytics:read` for the chart. Read-only scopes are enough; use a token with no write scopes.

The token is kept in a JavaScript variable only. It is never written to storage, a cookie or the address bar, the field is emptied as soon as you connect, and it is gone when you reload or press Disconnect. The page's content security policy lets it talk only to https addresses and localhost.

**Cross-origin note:** a page opened from a file or another site can only call the API if your Egg allows cross-origin reads (CORS) on `/api/v1`. If it does not, the page says the browser could not reach the address. In that case serve the page from the same address as Egg behind your reverse proxy, or use the Node or Python example instead.
