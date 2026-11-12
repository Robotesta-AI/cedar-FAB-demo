/**
 * The bank's core system, which moves the money. Simulated: in this demonstration it runs in memory, and the tests
 * (or a demo operator) can make the next posting time out, before or after the money moved.
 */
export type CoreOutcome = "POSTED" | "TIMEOUT";

/** How the next posting behaves. TIMEOUT_AFTER_POSTING is the late success of BRD 3.3 rule 21. */
export type NextPosting = "NORMAL" | "TIMEOUT_BEFORE_POSTING" | "TIMEOUT_AFTER_POSTING";

export class SimulatedCoreBanking {
  private readonly posted = new Set<string>();
  next: NextPosting = "NORMAL";

  /** Posts once per key: a key already posted is never applied again. */
  post(key: string, apply: () => void): CoreOutcome {
    if (this.posted.has(key)) return "POSTED";
    const mode = this.next;
    this.next = "NORMAL";
    if (mode === "TIMEOUT_BEFORE_POSTING") return "TIMEOUT";
    apply();
    this.posted.add(key);
    return mode === "TIMEOUT_AFTER_POSTING" ? "TIMEOUT" : "POSTED";
  }

  wasPosted(key: string): boolean {
    return this.posted.has(key);
  }
}
