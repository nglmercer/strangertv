# WebRTC / TURN

Media flows peer-to-peer; the server does signaling plus TURN credentials.
STUN alone will not work for every network, so configure TURN for production.

## Credentials API

Authenticated clients fetch short-lived ICE servers from:

```text
GET /api/v1/ice
```

With no TURN configured the API falls back to STUN only (fine for local dev).

## TURN (coturn)

1. Run coturn with a static auth secret.
2. Set `TURN_SECRET` to that secret.
3. Set `TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349`.

Reference config: `deploy/turnserver.conf.example`. For a local coturn next
to the stack:

```bash
docker compose --profile turn up --build
```

Related: [Configuration](./configuration.md) ·
[Architecture](./architecture.md).
