---
"@staffroom/core": patch
---

Test the demo playback speed as arithmetic rather than with a stopwatch.

The old test ran the same fixture at two speeds and compared how long each took.
That measured the machine: on a loaded Windows CI runner the second run was
sometimes the slower one however fast the code was, and the test said nothing
about the code either way. The delay is now a small exported function with its
cases checked directly.
