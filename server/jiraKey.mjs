/** Extract a Jira issue key from a bare key or common Atlassian URLs. */
export function parseJiraKey(input) {
  const str = String(input || "").trim();
  if (!str) return null;

  const bare = str.match(/^([A-Za-z][A-Za-z0-9]+-\d+)$/);
  if (bare) return bare[1].toUpperCase();

  try {
    const url = new URL(str);
    const browse = url.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)/i);
    if (browse) return browse[1].toUpperCase();

    const selected = url.searchParams.get("selectedIssue");
    if (selected && /^[A-Za-z][A-Za-z0-9]+-\d+$/i.test(selected)) {
      return selected.toUpperCase();
    }

    const issuePath = url.pathname.match(/\/issues\/([A-Za-z][A-Za-z0-9]+-\d+)/i);
    if (issuePath) return issuePath[1].toUpperCase();
  } catch {
    // not a URL
  }

  return null;
}

export function formatJiraTicketDescription(issue) {
  return [
    `${issue.key}: ${issue.summary}`,
    issue.description ? `\n\nDescription:\n${issue.description}` : "",
    issue.acceptanceCriteria ? `\n\nAcceptance Criteria:\n${issue.acceptanceCriteria}` : "",
  ].join("").trim();
}

/** True when the body is only a key/URL and should be expanded via the Jira API. */
export function shouldLoadJiraTicket(description, jiraKey) {
  if (!jiraKey) return false;
  const trimmed = String(description || "").trim();
  if (!trimmed) return true;
  if (trimmed.toUpperCase() === jiraKey.toUpperCase()) return true;
  if (parseJiraKey(trimmed) === jiraKey.toUpperCase()) return true;
  return false;
}
