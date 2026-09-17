# Staffroom in a container.
#
# Installed from npm rather than built from this tree, so the image contains
# exactly what `npx staffroom` gives everybody else. An image built from a
# working copy would be a second way to produce the product, and the two would
# eventually disagree about something nobody was watching.
#
# Node 22 rather than the 20 the plan named: the office refuses to start below
# 22, so a node:20 image would build cleanly and fail on first run.
FROM node:22-bookworm-slim

# The version to install. Pinned at build time so `:0.2.0` and `:latest` are
# genuinely different images rather than the same tag resolving differently
# depending on when it was pulled.
ARG STAFFROOM_VERSION=latest

# better-sqlite3 ships prebuilds for common platforms and falls back to building
# from source. ca-certificates is needed the moment a provider is configured.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Installed globally as root, then run as the node user. Nothing at runtime
# needs to write to the install.
RUN npm install -g "staffroom@${STAFFROOM_VERSION}" \
  && npm cache clean --force

ENV NODE_ENV=production \
    # Makes the office say the thing that is actually true in a container: the
    # bind address is not the decision, the published port is.
    STAFFROOM_IN_DOCKER=1 \
    # The mount point. `-v $PWD/office:/office` and the office is on the host.
    STAFFROOM_OFFICE=/office

# Owned by the user that runs, so a bind mount from the host works without the
# container needing to chown somebody else's folder.
RUN mkdir -p /office && chown -R node:node /office
VOLUME ["/office"]

USER node
WORKDIR /office
EXPOSE 4242

# 0.0.0.0 inside the container, because the container's own interface is the
# only way the published port can reach it. What the outside world can get to is
# decided by `-p`, and the startup warning says so.
#
# --no-open because there is no browser in here to open.
CMD ["staffroom", "start", "--office", "/office", "--host", "0.0.0.0", "--port", "4242", "--no-open"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4242/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
