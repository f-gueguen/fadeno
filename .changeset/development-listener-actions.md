---
"@fadeno/framework": patch
---

Allow browser-native actions during development when their origin exactly
matches the HTTP loopback listener, using a listener-scoped development
session cookie while retaining the production HTTPS and Secure-cookie
boundaries.
