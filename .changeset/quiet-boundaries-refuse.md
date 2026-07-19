---
"@fadeno/framework": patch
---

Refuse malformed configuration text and file bytes before compiler admission and
classify invalid UTF-8 or multipart action bodies as `FADENO_ACTION_BODY`
instead of an internal framework failure.
