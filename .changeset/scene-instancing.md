---
"@staffroom/web": patch
---

The office costs the same to draw however many people work there. People and
desks are drawn as instanced meshes, so a room of thirty-five went from 821 draw
calls to 37 — the same number a room of four costs. Desks in an office with
other than six departments now face the Brain, which they did not.
