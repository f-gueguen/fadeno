# Packages

`framework/` is the private V1 package selected by ADRs 0024 and 0025. Its
runtime-neutral root and Node adapter subpath are built, packed, installed, and
executed by the repository check.

The workspace identifier is internal and not a registry choice. No package is
published or production-supported yet. Additional packages remain forbidden
until an independent consumer and accepted ADR justify them.
