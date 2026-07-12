# Revalidation results

Immutable attempt directories begin only with K0-10B exact-source execution.
K0-10A checks this directory contains only this notice. K0-10B allocates an
attempt before preflight, retains every launched attempt, and uses the first
complete reference-valid attempt for the H4 decision; valid attempts have no
retry path.
