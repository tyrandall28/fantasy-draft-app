/**
 * What the Ask AI page shows while the feature is held.
 *
 * Deliberately has no input box. The point is that a question cannot be sent
 * at all, rather than sent and rejected — the previous behaviour let someone
 * type, wait, and receive a red error written for whoever runs the server.
 *
 * Amber, matching PositionDataNotice: the same "this isn't broken, it just
 * isn't ready" meaning the palette already assigns to `caution`. The example
 * questions are kept, dimmed and inert, because they're the clearest possible
 * statement of what the feature will do.
 *
 * The copy deliberately says nothing about *why* it's held. The real reason is
 * cost control and the missing per-user quota (see the backend's
 * api/assistant.py), which is operator reasoning and not a user's concern —
 * an earlier draft spelled it out and read like an apology. Keep it framed as
 * a staged rollout.
 */

import { Link } from "react-router-dom";

interface Props {
  /** Example questions, shown as dimmed previews rather than buttons. */
  examples: readonly string[];
  /** Season range covered by the data, when known. */
  seasons: number[] | null;
}

export default function AssistantComingSoon({ examples, seasons }: Props) {
  const range = seasons && seasons.length > 0
    ? `${Math.min(...seasons)}–${Math.max(...seasons)}`
    : null;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-2xl items-center px-4">
      <div className="w-full py-12">
        <div className="panel rounded-xl px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="text-sm leading-5 text-caution">
              ⓘ
            </span>
            <span className="badge-sm bg-caution/15 text-caution uppercase tracking-wide">
              Coming soon
            </span>
          </div>

          <h1 className="mt-4 text-2xl font-bold text-chalk">Ask the Data</h1>

          <p className="mt-3 text-sm leading-6 text-chalk-dim">
            Ask questions about NFL player stats in plain English
            {range && ` (${range})`} and get answers read straight from the
            database — no made-up numbers.
          </p>
          <p className="mt-3 text-sm leading-6 text-chalk-dim">
            We're opening this one up in stages to make sure it holds up under
            real use. It'll be available to everyone once testing wraps.
          </p>

          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-wide text-chalk-mut">
              What you'll be able to ask
            </p>
            <ul className="mt-3 space-y-2">
              {examples.map((example) => (
                <li
                  key={example}
                  className="panel-inset px-4 py-2.5 text-sm text-chalk-mut select-none"
                >
                  {example}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-8 text-sm text-chalk-mut">
            In the meantime, the same data is all on the{" "}
            <Link to="/analytics" className="text-accent hover:brightness-110">
              Analytics
            </Link>{" "}
            page.
          </p>
        </div>
      </div>
    </div>
  );
}
