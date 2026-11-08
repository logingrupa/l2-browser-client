# Private preview

https://l2.kingdom.lv serves the `dist` build from DATABASE-PC behind an invitation gate. It shows the earlier 20_20 slice and is not a stage A, parity or performance result. Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- `pnpm preview:private start|stop|status` runs the nginx origin on `127.0.0.1:8189`, serving only `dist`. `pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Start|Stop|Status` runs the `l2-browser-client-preview` tunnel; `Start` also starts the origin, `Stop` stops only the connector.
- Anonymous requests get 403. The invitation sets a Secure, HttpOnly, SameSite=Lax cookie and redirects to `/?authored=1`. Responses are `private, no-store`, `noindex`, `no-referrer`.
- Open it with the "L2 Browser Preview" desktop shortcut on IMPORTA-PC or DATABASE-PC, or on DATABASE-PC with `pwsh -NoProfile -File scripts/open-private-preview.ps1 -InviteFile .assets/private-preview/private-invite.txt`. A 403 means that browser has not opened the invitation.
- The invitation and key are bearer secrets in ignored `.assets/private-preview/`. Never put them in chat, screenshots, tracked files, traces or HAR; sanitize logs.
- `scripts/private-preview-cloudflare.ps1` provisions the tunnel and DNS route on IMPORTA-PC, where the Cloudflare credentials stay. It is a dry run without `-Apply`.
- Deploy: tunnel `Stop`, `pnpm preview:private stop`, `pnpm build`, tunnel `Start`, halting on any non-zero exit, then a receipt under `artifacts/private-preview/`. Live build: 2026-11-06 00:11 Riga time (`artifacts/private-preview/startup-loader-change/deployment.json`).
- Checks: `node scripts/check-private-preview-external.mjs --output <new dir>` and `node scripts/check-private-preview-burst.mjs --output-dir artifacts/private-preview/<new dir>` (HEAD only). `node scripts/check-private-preview.mjs` restarts the origin; run it only in a maintenance window.

## Open

- NOED-01: the preview moves to `/`. Until then the redirect and tunnel helper point at `?authored=1`, and all three checks read `/scene/native-world.babylon`, which only `pnpm generate:editor` generates, not `pnpm build`.
- A startup reveal fix is staged in `artifacts/private-preview/native-reveal/dist-stage/`, not deployed.
- No service or startup task: start both by hand after a DATABASE-PC restart.
- No physical phone or Apple GPU check.

## Pointers

IMPORTA-PC run folder `C:\Users\rolan\fleet\runs\2026-11-05-l2-browser-private-preview` (`Check-ImportaPreview.ps1 -NormalOnly`, `Invoke-PreviewShortcut.ps1`).
