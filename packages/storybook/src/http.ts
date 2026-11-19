/** The outcome of one GET, with the body read as text. Never throws for network failures. */
export type FetchOutcome =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly contentType: string;
      /** The request followed at least one redirect. */
      readonly redirected: boolean;
      readonly body: string;
    }
  | { readonly kind: 'network-error'; readonly message: string };

/** GETs `url` with a timeout. Responses of any status are returned; only network errors are folded. */
export async function fetchText(url: string, timeoutMs: number): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json, text/html;q=0.9, */*;q=0.8' },
    });
    return {
      kind: 'response',
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      redirected: response.redirected,
      body: await response.text(),
    };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
    const message = error instanceof Error ? `${error.message}${cause}` : String(error);
    return { kind: 'network-error', message };
  }
}

/** Describes an outcome in a few words for a diagnostic's `data`. */
export function describeOutcome(outcome: FetchOutcome): string {
  return outcome.kind === 'network-error' ? outcome.message : `HTTP ${outcome.status}`;
}

/** Parses a JSON body; `undefined` when it is not JSON. */
export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}
