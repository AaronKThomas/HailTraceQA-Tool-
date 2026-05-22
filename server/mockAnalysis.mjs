// Demo-mode QA analysis builder. Returns the same response shape that the
// real HailTrace/OpenAI paths produce so the frontend renders identically
// whether or not credentials are configured.
//
// Pure function, no side effects, no external calls.

export function buildMockAnalysis(description, jiraKey) {
  const lower = description.toLowerCase();
  const failSignals = ["error", "broken", "fail", "crash", "missing"];
  const manualSignals = ["manual", "verify", "review", "check visually"];

  if (failSignals.some((signal) => lower.includes(signal))) {
    return {
      verdict: "FAIL",
      analysis: [
        "WHAT IS BEING TESTED",
        description,
        "",
        "API RESULTS",
        "Demo mode: failure-oriented language detected in the request.",
        "",
        "CODE ANALYSIS",
        "No live HailTrace API call was made.",
        "",
        "ERROR LOCATION",
        jiraKey ? `Potentially related to ${jiraKey}.` : "No Jira ticket attached.",
        "",
        "RECOMMENDATIONS",
        "Add HAILTRACE_API_BASE_URL and HAILTRACE_API_KEY to .env for live QA.",
        "",
        "VERDICT: FAIL",
      ].join("\n"),
      apiResults: [
        {
          type: "REST",
          method: "POST",
          endpoint: "/mock/run-test",
          description: "Demo QA evaluation",
          result: { ok: false, status: 500 },
          error: "Demo mode simulated failure.",
        },
      ],
      playwrightLog: "[demo] Browser flow aborted after simulated failure.",
    };
  }

  if (manualSignals.some((signal) => lower.includes(signal))) {
    return {
      verdict: "NEEDS MANUAL CHECK",
      analysis: [
        "WHAT IS BEING TESTED",
        description,
        "",
        "API RESULTS",
        "Demo mode: request appears to need human verification.",
        "",
        "CODE ANALYSIS",
        "No live HailTrace API call was made.",
        "",
        "RECOMMENDATIONS",
        "Review manually or connect the HailTrace API in .env.",
        "",
        "VERDICT: NEEDS MANUAL CHECK",
      ].join("\n"),
      apiResults: [
        {
          type: "REST",
          method: "POST",
          endpoint: "/mock/run-test",
          description: "Demo QA evaluation",
          result: { ok: true, status: 202 },
        },
      ],
      playwrightLog: "[demo] Browser flow requires human review.",
    };
  }

  return {
    verdict: "PASS",
    analysis: [
      "WHAT IS BEING TESTED",
      description,
      "",
      "API RESULTS",
      "Demo mode: simulated successful QA evaluation.",
      "",
      "CODE ANALYSIS",
      "No live HailTrace API call was made.",
      "",
      "RECOMMENDATIONS",
      "Add HAILTRACE_API_BASE_URL and HAILTRACE_API_KEY to .env for live QA.",
      "",
      "VERDICT: PASS",
    ].join("\n"),
    apiResults: [
      {
        type: "REST",
        method: "POST",
        endpoint: "/mock/run-test",
        description: "Demo QA evaluation",
        result: { ok: true, status: 200 },
      },
    ],
    playwrightLog: "[demo] Browser flow completed successfully.",
  };
}
