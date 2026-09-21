import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders an assistant answer as markdown.
 *
 * The model writes markdown -- bold, bullets, and a table whenever the answer is
 * a leaderboard -- and the page used to print it raw, so a README screenshot of
 * the feature showed literal `**Heads up:**` and a table as a wall of pipes.
 *
 * Everything below is styled from the theme tokens and component classes rather
 * than markdown defaults, because a default `<table>` or `<code>` drops a white
 * box into a dark bubble.
 */

/** Flatten a hast node to its text, so a cell's value can be inspected. */
function nodeText(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(nodeText).join("");
}

// "24.5", "1,204", "-3", "68%", "0" -- but not "9 catches" or "ARI".
const NUMERIC = /^[+-]?\d[\d,]*\.?\d*%?$/;

/**
 * Which columns hold numbers, judged from the body rows.
 *
 * Alignment is decided per column and applied to the header too. Right-aligning
 * the numbers but not their heading is exactly the drift that made the analytics
 * table look broken -- the heading has to sit over its own column.
 */
function numericColumns(tableNode: unknown): boolean[] {
  const node = tableNode as { children?: { tagName?: string; children?: unknown[] }[] };
  const cols: boolean[] = [];
  for (const section of node?.children ?? []) {
    if (section.tagName !== "tbody") continue;
    for (const row of (section.children ?? []) as { tagName?: string; children?: unknown[] }[]) {
      if (row.tagName !== "tr") continue;
      const cells = ((row.children ?? []) as { tagName?: string }[]).filter(
        (c) => c.tagName === "td",
      );
      cells.forEach((cell, i) => {
        const text = nodeText(cell).trim();
        // Blanks and dashes don't make a column non-numeric -- a missing stat is
        // still a stat column.
        const neutral = text === "" || text === "-" || text === "—";
        const numeric = NUMERIC.test(text);
        cols[i] = cols[i] === undefined ? numeric : cols[i] && (numeric || neutral);
      });
    }
  }
  return cols;
}

/** Tag each cell in a row with its column index, so th/td can align themselves. */
function withColumnIndex(children: ReactNode) {
  let col = 0;
  return Children.map(children, (child) =>
    isValidElement<{ "data-col"?: number }>(child)
      ? cloneElement(child, { "data-col": col++ })
      : child,
  );
}

function alignClass(cols: boolean[], index: unknown): string {
  const i = typeof index === "number" ? index : -1;
  return cols[i] ? "text-right stat-num" : "text-left";
}

export default function AnswerMarkdown({ content }: { content: string }) {
  // Recomputed per table by the `table` renderer below; `th`/`td` read it from
  // this closure rather than a context, since a table can't nest here.
  let cols: boolean[] = [];

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
        // Bold is the model's emphasis on the answer itself -- the player who
        // leads, the number asked for -- so it steps up to full chalk out of the
        // bubble's dimmed body text.
        strong: ({ children }) => <strong className="font-medium text-chalk">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {children}
          </a>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        h1: ({ children }) => (
          <h3 className="mt-3 mb-1 font-medium text-chalk first:mt-0">{children}</h3>
        ),
        h2: ({ children }) => (
          <h3 className="mt-3 mb-1 font-medium text-chalk first:mt-0">{children}</h3>
        ),
        h3: ({ children }) => (
          <h3 className="mt-3 mb-1 font-medium text-chalk first:mt-0">{children}</h3>
        ),
        code: ({ children }) => (
          <code className="rounded bg-ink-900 px-1 py-0.5 font-mono text-[0.9em] text-chalk">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="scroll-quiet mb-2 overflow-x-auto rounded-lg bg-ink-900 p-3 text-xs last:mb-0">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-ink-600 pl-3 text-chalk-mut">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-ink-600" />,
        // The table breaks out of the bubble's horizontal padding so a
        // leaderboard gets the full width to sit in, and scrolls quietly rather
        // than stretching the bubble if it's wider still.
        table: ({ node, children }) => {
          cols = numericColumns(node);
          return (
            <div className="scroll-quiet -mx-4 my-2 overflow-x-auto border-y border-ink-600">
              <table className="w-full text-xs">{children}</table>
            </div>
          );
        },
        thead: ({ children }) => <thead>{children}</thead>,
        tr: ({ children }) => (
          <tr className="border-b border-ink-600/60 last:border-0">{withColumnIndex(children)}</tr>
        ),
        th: ({ children, ...props }) => (
          <th
            className={`px-3 py-1.5 font-medium whitespace-nowrap text-chalk-mut ${alignClass(
              cols,
              (props as { "data-col"?: number })["data-col"],
            )}`}
          >
            {children}
          </th>
        ),
        td: ({ children, ...props }) => (
          <td
            className={`px-3 py-1.5 whitespace-nowrap ${alignClass(
              cols,
              (props as { "data-col"?: number })["data-col"],
            )}`}
          >
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
