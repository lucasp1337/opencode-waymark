const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\/\S/i;
const ANCHORED_PATH = /^(~|\.{1,2})?[/\\]\S|^[A-Za-z]:[/\\]/;
const PATH_WITH_FILE = /[/\\][^/\\]*[^/\\.]\.[A-Za-z0-9]+$/;
const DIRECTORY_PATH = /^[^/\\]+([/\\][^/\\]+)*[/\\]$/;
const TICKET_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const LEADING_PUNCTUATION = /^[("'`<[]+/;
const TRAILING_PUNCTUATION = /[)"'`>\],.;:!?]+$/;

// Structural only: a URL, an anchored path, a path naming a file or directory, or a ticket key.
// Ticket-shaped tokens such as "UTF-8" also pass; the agent owns the content.
function isLocator(token: string): boolean {
  const core = token.replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, "");
  return [URL_SCHEME, ANCHORED_PATH, PATH_WITH_FILE, DIRECTORY_PATH, TICKET_KEY].some((shape) =>
    shape.test(core),
  );
}

export function hasLocator(text: string): boolean {
  return text.split(/\s+/).some(isLocator);
}
