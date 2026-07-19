---
"@fadeno/framework": patch
---

Refuse malformed configuration and environment file bytes before compiler or
build admission, and classify invalid UTF-8, invalid percent-decoded text, or
malformed multipart action bodies as `FADENO_ACTION_BODY` before application
code can observe replacement text.
