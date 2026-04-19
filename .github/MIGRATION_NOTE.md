# Photo migration redeploy trigger

On 2026-04-19 the migrate-photos workflow converted ~281 Tilda photos to
`/photos/*.webp` and rewrote DATA+EXTRA JSON (commit 41c170f). Vercel
cancelled that production deploy; this file exists to force a fresh deploy.
