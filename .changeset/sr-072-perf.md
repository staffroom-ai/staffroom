---
"@staffroom/web": patch
---

Measures what the office costs to draw, so it cannot get slower without somebody
noticing.

A perf test runs the real office with thirty-five people in it and holds it to
budgets for draw calls, triangles, frame pacing and time to first frame. It runs
on macOS in CI, where there is a GPU: a frame time from a software rasteriser
would be a number about the build machine rather than about the scene.

No change to the office itself. The probe that reads the renderer's counters is
silent unless a test asks for numbers, and adds 0.15 kB to the scene chunk.
