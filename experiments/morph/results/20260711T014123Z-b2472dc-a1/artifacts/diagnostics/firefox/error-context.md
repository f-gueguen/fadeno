# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: qualification.spec.ts >> qualification-diagnostic-qualification
- Location: experiments/morph/tests/qualification.spec.ts:790:1

# Error details

```
Error: FADENO_MORPH_QUALIFICATION_FAILURE: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "scroll",
+ ]
```

# Page snapshot

```yaml
- main [ref=e2]:
  - generic [ref=e3]:
    - status [ref=e4]: inserted
    - generic [ref=e5]: Nested spacer
  - status [ref=e6]: peer-a
```

# Test source

```ts
  730 |         blockedRequests = [];
  731 |         pageErrors = [];
  732 |         try {
  733 |           records.push(await runScenario(
  734 |             page,
  735 |             scenario,
  736 |             ordinal,
  737 |             engine,
  738 |             blockedRequests,
  739 |             pageErrors,
  740 |           ));
  741 |         } catch (error: unknown) {
  742 |           if (!(error instanceof QualificationScenarioProofError)) throw error;
  743 |           failures.push({
  744 |             operation: {
  745 |               profile,
  746 |               engine,
  747 |               caseId: scenario.fixture.id,
  748 |               state: scenario.fixture.state,
  749 |               operation: scenario.fixture.operation,
  750 |               ordinal,
  751 |               failure: error.message,
  752 |             },
  753 |             observation: error.record,
  754 |           });
  755 |         }
  756 |         activeScenario = undefined;
  757 |         activeOrdinal = 0;
  758 |       }
  759 |     }
  760 |     await attachJson(testInfo, "qualification-records", records);
  761 |     const summary = verifyQualificationOutcome(records, failures, profile, engine);
  762 |     await attachJson(testInfo, "qualification-failures", failures);
  763 |     await attachJson(testInfo, "qualification-summary", summary);
  764 |   } catch (error: unknown) {
  765 |     const message = error instanceof Error ? error.message : String(error);
  766 |     await attachJson(testInfo, "qualification-records", records);
  767 |     await attachJson(testInfo, "qualification-summary", {
  768 |       profile,
  769 |       engine,
  770 |       expectedRecords: MORPH_QUALIFICATION_SCENARIOS.length * repetitions,
  771 |       completedRecords: records.length,
  772 |       failure: message,
  773 |     });
  774 |     await attachJson(testInfo, "qualification-failures", [{
  775 |       operation: {
  776 |       profile,
  777 |       engine,
  778 |       caseId: activeScenario?.fixture.id,
  779 |       state: activeScenario?.fixture.state,
  780 |       operation: activeScenario?.fixture.operation,
  781 |       ordinal: activeOrdinal,
  782 |       failure: message,
  783 |       },
  784 |       observation: null,
  785 |     }]);
  786 |     throw new Error(`FADENO_MORPH_QUALIFICATION_FAILURE: ${message}`);
  787 |   }
  788 | });
  789 | 
  790 | test(`qualification-diagnostic-${profile}`, async ({ page }, testInfo: TestInfo) => {
  791 |   test.setTimeout(60_000);
  792 |   const engine = qualificationEngine(page);
  793 |   const scenario = MORPH_QUALIFICATION_SCENARIOS.find(
  794 |     (candidate) => candidate.fixture.id === "element-scroll-insert",
  795 |   );
  796 |   if (!scenario) throw new Error("FADENO_MORPH_DIAGNOSTIC_SCENARIO_MISSING");
  797 |   const blockedRequests: string[] = [];
  798 |   const pageErrors: string[] = [];
  799 |   await verifyUnhandledRejectionSensor(page);
  800 |   page.on("pageerror", (error) => pageErrors.push(error.message));
  801 |   await page.route(/^https?:\/\//u, async (route) => {
  802 |     blockedRequests.push(route.request().url());
  803 |     await route.abort("blockedbyclient");
  804 |   });
  805 |   try {
  806 |     const record = await runScenario(
  807 |       page,
  808 |       scenario,
  809 |       repetitions,
  810 |       engine,
  811 |       blockedRequests,
  812 |       pageErrors,
  813 |     );
  814 |     await attachJson(testInfo, "diagnostic-record", record);
  815 |   } catch (error: unknown) {
  816 |     if (!(error instanceof QualificationScenarioProofError)) throw error;
  817 |     const failure: QualificationFailureEvidence = {
  818 |       operation: {
  819 |         profile,
  820 |         engine,
  821 |         caseId: scenario.fixture.id,
  822 |         state: scenario.fixture.state,
  823 |         operation: scenario.fixture.operation,
  824 |         ordinal: repetitions,
  825 |         failure: error.message,
  826 |       },
  827 |       observation: error.record,
  828 |     };
  829 |     await attachJson(testInfo, "diagnostic-failure", failure);
> 830 |     throw new Error(`FADENO_MORPH_QUALIFICATION_FAILURE: ${error.message}`);
      |           ^ Error: FADENO_MORPH_QUALIFICATION_FAILURE: expect(received).toEqual(expected) // deep equality
  831 |   }
  832 | });
  833 | 
```