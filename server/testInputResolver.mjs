// Normalize a /run-test request into a (text, ticketKey) pair.
//
// If the caller passed bare Jira input AND Jira is configured, we expand the
// ticket into a richer brief. Failures are logged and swallowed so a flaky
// Jira does not break test runs.

import { fetchJiraIssue } from "./integrations.mjs";
import { formatJiraTicketDescription, parseJiraKey, shouldLoadJiraTicket } from "./jiraKey.mjs";
import { requireNonEmptyString } from "./security.mjs";
import { hasRealJiraConfig } from "./config.mjs";

export async function resolveTestInput(config, description, jiraKey) {
  let text = requireNonEmptyString(description, "Description", { min: 3, max: 10000 });
  let ticketKey = jiraKey ? String(jiraKey).toUpperCase() : parseJiraKey(text);

  if (ticketKey && hasRealJiraConfig(config) && shouldLoadJiraTicket(text, ticketKey)) {
    try {
      const issue = await fetchJiraIssue(config, ticketKey);
      ticketKey = (issue.key || ticketKey).toUpperCase();
      text = formatJiraTicketDescription(issue);
    } catch (error) {
      console.warn(`[jira] Could not load ${ticketKey}: ${error.message}`);
    }
  }

  return { text, ticketKey: ticketKey || null };
}
