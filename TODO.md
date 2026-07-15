# Status

Product code is feature-complete for v1 (including polish: interests UI, refresh, OpenAPI, PWA, offline). Remaining is **hosting**:

- [ ] DNS + TLS
- [ ] Turso + backups
- [ ] coturn / `TURN_*`
- [ ] `EMAIL_WEBHOOK_URL` + `ALERT_WEBHOOK_URL`
- [ ] Strong `ADMIN_KEY`

```bash
make dev
npm run test:all
make docker
make docker-turn
```
