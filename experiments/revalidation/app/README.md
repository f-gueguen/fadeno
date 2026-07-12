# Revalidation application

The K0-09 application boundary is a private deterministic in-memory benchmark:

- one authenticated page reads six unique resources through nine calls;
- one successful action completes task row 4,242 in a 10,000-row dataset;
- one denied action proves the expected-error/no-mutation path;
- correctness-first revalidation reads all six resources in a new request;
- the comparison-only selective baseline reads `tasks` once.

The resource IDs, auth record, page model, mutation, and baseline are evidence
ABI only. They are not an application template or public Fadeno API.
