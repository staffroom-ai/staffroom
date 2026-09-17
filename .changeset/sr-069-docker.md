---
"@staffroom/server": minor
---

Run the office in a container.

```bash
docker run -d --name staffroom \
  -p 127.0.0.1:4242:4242 \
  -v $PWD/office:/office \
  -e ANTHROPIC_API_KEY \
  ghcr.io/staffroom-ai/staffroom:latest
```

Your office stays on the host; the container is disposable. Without a mount it
still runs, makes an office inside itself and comes up in demo mode, which is a
quick way to look at it.

Inside the container the office listens on all interfaces, because the published
port is the only way in. The startup warning now says that, instead of telling
you to put a bind address behind a VPN when the bind address is not the thing you
can change.
