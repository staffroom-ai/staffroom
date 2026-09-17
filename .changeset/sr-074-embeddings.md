---
"@staffroom/core": minor
---

Find a note by what it means, not only by the words in it.

Keyword search fails in one common way: you ask what you charge for a retainer
and the note says "monthly fee". Same thing, no shared words, nothing found.

```yaml
brain:
  embeddings:
    enabled: true
    model: nomic-embed-text
```

Both searches then run and the two rankings are merged, so a note either method
is confident about still comes back, and a vector hit shows the part of the note
that matched rather than its opening line.

Off by default, because turning it on means sending every note in your business
to whoever provides the model. With Ollama that is your own machine. With a
hosted provider it is not, and that is your call rather than a default's. A
provider with no embedding model says so and search stays keyword only.
