# Revalidation application

The K0-09 application boundary is a private deterministic in-memory benchmark:

- one authenticated page reads six unique resource/input identities through
  nine calls, plus controls for equivalent and distinct inputs;
- one successful action completes task row 4,242 in a 10,000-row dataset;
- one denied action proves the expected-error/no-mutation path;
- correctness-first revalidation follows the six-resource baseline manifest in
  a new request;
- the comparison-only baseline manifest reads `tasks` once;
- task freshness is proven from the rendered target value, independently of
  mutation state or aggregate counters.

The resource IDs, auth record, page model, mutation, and baseline are evidence
ABI only. They are not an application template or public Fadeno API.
