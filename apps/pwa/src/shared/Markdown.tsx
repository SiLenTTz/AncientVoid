import type { ComponentChildren } from "preact";
import { parseMarkdown, type Block, type Inline } from "./markdown.ts";

/** BUG-0067: agent Markdown as Preact nodes — text only, never innerHTML. */
export function Markdown({ text, class: cls }: { text: string; class?: string }) {
  return <div class={`markdown${cls ? ` ${cls}` : ""}`}>{parseMarkdown(text).map(block)}</div>;
}

function inline(nodes: Inline[]): ComponentChildren {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "strong":
        return <strong key={i}>{inline(n.children)}</strong>;
      case "em":
        return <em key={i}>{inline(n.children)}</em>;
      case "del":
        return <del key={i}>{inline(n.children)}</del>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
            {inline(n.children)}
          </a>
        );
    }
  });
}

function block(b: Block, i: number): ComponentChildren {
  switch (b.kind) {
    case "heading": {
      // Chat rows are small: # maps to the row's largest step, not a page title.
      const Tag = (["h3", "h3", "h4", "h5", "h6", "h6"] as const)[b.level - 1]!;
      return <Tag key={i}>{inline(b.content)}</Tag>;
    }
    case "paragraph":
      return (
        <p key={i}>
          {b.lines.map((line, j) => (
            <>
              {j > 0 && <br />}
              {inline(line)}
            </>
          ))}
        </p>
      );
    case "code":
      return (
        <pre key={i} class="md-code" data-lang={b.lang || undefined}>
          <code>{b.text}</code>
        </pre>
      );
    case "list": {
      const items = b.items.map((it, j) => (
        <li key={j}>
          {inline(it.content)}
          {it.children.map(block)}
        </li>
      ));
      return b.ordered ? (
        <ol key={i} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={i}>{items}</ul>
      );
    }
    case "table":
      return (
        <div key={i} class="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote":
      return <blockquote key={i}>{b.blocks.map(block)}</blockquote>;
    case "rule":
      return <hr key={i} />;
  }
}
