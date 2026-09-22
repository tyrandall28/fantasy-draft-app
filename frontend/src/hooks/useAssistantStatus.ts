import { useEffect, useState } from "react";
import { getAssistantStatus, type AssistantStatus } from "../api/assistant";

/**
 * Whether the AI assistant is answering questions on this deployment.
 *
 * Two places need this and must not disagree: the navbar, which shows a
 * "soon" badge beside the link, and the page itself, which renders either the
 * chat or a coming-soon notice. So the request is made once and shared.
 *
 * The result is cached at module scope rather than in a context, because it's
 * one immutable boolean about the server — it cannot change while the tab is
 * open, and a provider would be ceremony around a value that never updates.
 */

let cached: AssistantStatus | null = null;
let inFlight: Promise<AssistantStatus> | null = null;

function fetchOnce(): Promise<AssistantStatus> {
  if (cached) return Promise.resolve(cached);
  // Several components mounting together share one request.
  inFlight ??= getAssistantStatus()
    .then((status) => {
      cached = status;
      return status;
    })
    .catch(() => {
      // Treat an unreachable status endpoint as held. Failing closed keeps a
      // network blip from opening an input box that spends money, and the
      // worst case is a "coming soon" page on a feature that does work.
      const held: AssistantStatus = { enabled: false, message: null };
      cached = held;
      return held;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export interface UseAssistantStatus {
  /** Null while the answer is unknown — render neither state yet. */
  enabled: boolean | null;
  message: string | null;
}

export function useAssistantStatus(): UseAssistantStatus {
  const [status, setStatus] = useState<AssistantStatus | null>(cached);

  useEffect(() => {
    if (status) return;
    let active = true;
    fetchOnce().then((s) => {
      if (active) setStatus(s);
    });
    return () => {
      active = false;
    };
  }, [status]);

  return { enabled: status ? status.enabled : null, message: status?.message ?? null };
}
