---
"@staffroom/core": patch
---

Say plainly that the 0600 mode on stored MCP tokens is not enforced on Windows.
NTFS has no POSIX mode bits, so chmod there is close to a no-op; the file is
still inside the office folder, which normally sits under the user's profile and
inherits its ACL, but that is the operating system's protection rather than ours.
