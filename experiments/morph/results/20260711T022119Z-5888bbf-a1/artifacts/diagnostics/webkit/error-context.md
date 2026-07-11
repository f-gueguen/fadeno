# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: qualification.spec.ts >> qualification-diagnostic-qualification
- Location: experiments/morph/tests/qualification.spec.ts:791:1

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
  732 |         pageErrors = [];
  733 |         try {
  734 |           records.push(await runScenario(
  735 |             page,
  736 |             scenario,
  737 |             ordinal,
  738 |             engine,
  739 |             blockedRequests,
  740 |             pageErrors,
  741 |           ));
  742 |         } catch (error: unknown) {
  743 |           if (!(error instanceof QualificationScenarioProofError)) throw error;
  744 |           failures.push({
  745 |             operation: {
  746 |               profile,
  747 |               engine,
  748 |               caseId: scenario.fixture.id,
  749 |               state: scenario.fixture.state,
  750 |               operation: scenario.fixture.operation,
  751 |               ordinal,
  752 |               failure: error.message,
  753 |             },
  754 |             observation: error.record,
  755 |           });
  756 |         }
  757 |         activeScenario = undefined;
  758 |         activeOrdinal = 0;
  759 |       }
  760 |     }
  761 |     await attachJson(testInfo, "qualification-records", records);
  762 |     const summary = verifyQualificationOutcome(records, failures, profile, engine);
  763 |     await attachJson(testInfo, "qualification-failures", failures);
  764 |     await attachJson(testInfo, "qualification-summary", summary);
  765 |   } catch (error: unknown) {
  766 |     const message = error instanceof Error ? error.message : String(error);
  767 |     await attachJson(testInfo, "qualification-records", records);
  768 |     await attachJson(testInfo, "qualification-summary", {
  769 |       profile,
  770 |       engine,
  771 |       expectedRecords: MORPH_QUALIFICATION_SCENARIOS.length * repetitions,
  772 |       completedRecords: records.length,
  773 |       failure: message,
  774 |     });
  775 |     await attachJson(testInfo, "qualification-failures", [{
  776 |       operation: {
  777 |       profile,
  778 |       engine,
  779 |       caseId: activeScenario?.fixture.id,
  780 |       state: activeScenario?.fixture.state,
  781 |       operation: activeScenario?.fixture.operation,
  782 |       ordinal: activeOrdinal,
  783 |       failure: message,
  784 |       },
  785 |       observation: null,
  786 |     }]);
  787 |     throw new Error(`FADENO_MORPH_QUALIFICATION_FAILURE: ${message}`);
  788 |   }
  789 | });
  790 | 
  791 | test(`qualification-diagnostic-${profile}`, async ({ page }, testInfo: TestInfo) => {
  792 |   test.setTimeout(60_000);
  793 |   const engine = qualificationEngine(page);
  794 |   const decisionSignature = loadQualificationDecisionSignature();
  795 |   const scenario = MORPH_QUALIFICATION_SCENARIOS.find(
  796 |     (candidate) => candidate.fixture.id === decisionSignature.diagnosticCase,
  797 |   );
  798 |   if (!scenario) throw new Error("FADENO_MORPH_DIAGNOSTIC_SCENARIO_MISSING");
  799 |   const blockedRequests: string[] = [];
  800 |   const pageErrors: string[] = [];
  801 |   await verifyUnhandledRejectionSensor(page);
  802 |   page.on("pageerror", (error) => pageErrors.push(error.message));
  803 |   await page.route(/^https?:\/\//u, async (route) => {
  804 |     blockedRequests.push(route.request().url());
  805 |     await route.abort("blockedbyclient");
  806 |   });
  807 |   try {
  808 |     const record = await runScenario(
  809 |       page,
  810 |       scenario,
  811 |       repetitions,
  812 |       engine,
  813 |       blockedRequests,
  814 |       pageErrors,
  815 |     );
  816 |     await attachJson(testInfo, "diagnostic-record", record);
  817 |   } catch (error: unknown) {
  818 |     if (!(error instanceof QualificationScenarioProofError)) throw error;
  819 |     const failure: QualificationFailureEvidence = {
  820 |       operation: {
  821 |         profile,
  822 |         engine,
  823 |         caseId: scenario.fixture.id,
  824 |         state: scenario.fixture.state,
  825 |         operation: scenario.fixture.operation,
  826 |         ordinal: repetitions,
  827 |         failure: error.message,
  828 |       },
  829 |       observation: error.record,
  830 |     };
  831 |     await attachJson(testInfo, "diagnostic-failure", failure);
> 832 |     throw new Error(`FADENO_MORPH_QUALIFICATION_FAILURE: ${error.message}`);
      |           ^ Error: FADENO_MORPH_QUALIFICATION_FAILURE: expect(received).toEqual(expected) // deep equality
  833 |   }
  834 | });
  835 | 
```