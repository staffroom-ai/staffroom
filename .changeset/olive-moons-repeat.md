---
"@staffroom/core": minor
---

OpenAI-compatible adapter. Works with OpenAI, and with anything else speaking
chat-completions (Groq, Together, OpenRouter, LM Studio) by pointing `baseURL` at
it. Endpoints that reject `stream_options` are detected once and never asked
again; their token usage is estimated and marked as such.
