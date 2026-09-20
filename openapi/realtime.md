# SAMAL realtime (WebSocket)

`GET /v1/ws?token=<access_token>`  
or `Authorization: Bearer <access_token>`.

JSON envelopes both ways.

## Server → client

```json
{ "type": "message.created", "ts": "2026-01-01T00:00:00Z", "body": { /* Message */ } }
{ "type": "receipt.upserted", "ts": "...", "body": { "message_id": "...", "user_id": "...", "status": "delivered|read", "chat_id": "..." } }
{ "type": "typing", "ts": "...", "body": { "chat_id": "...", "user_id": "..." } }
{ "type": "call.updated", "ts": "...", "body": { /* Call */ } }
{ "type": "pong", "ts": "...", "body": {} }
```

## Client → server

```json
{ "type": "ping" }
{ "type": "typing", "chat_id": "<uuid>" }
```

Presence is an in-process heartbeat on the socket (TTL 45s). Do not poll Postgres from the phone. One API process is enough; run it on the same host as the public API.
