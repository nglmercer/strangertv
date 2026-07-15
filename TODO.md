# Implementation status

Most of the full feature backlog is implemented (2026-07-15). Remaining production work:

- [ ] HTTPS/WSS deployment + Turso production + backups
- [ ] Configure real TURN (`TURN_SECRET` + `TURN_URLS`)
- [ ] Set `ADMIN_KEY` and use `/api/admin/*` moderation in ops
- [ ] Playwright two-browser e2e
- [ ] Load testing and monitoring/alerts
- [ ] Email delivery for password reset (dev returns `devResetToken`)

See `ROADMAP.md` for the checklist. Run `npm run dev` for local UI + API.
