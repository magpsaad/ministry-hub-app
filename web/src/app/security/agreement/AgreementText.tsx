/** The agreement's wording as stored in agreement_versions.body (migration
 * 0086): a small, fixed subset of Markdown -- "## " headings, "- " bullets,
 * "1. " numbered items and plain paragraphs. Rendered as React text, so
 * nothing in the wording can ever become HTML. */

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets" | "numbers"; items: string[] };

function parse(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^- (.*)$/.exec(line);
    const number = /^\d+\. (.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3) });
    } else if (bullet || number) {
      flush();
      const kind = bullet ? "bullets" : "numbers";
      const last = blocks[blocks.length - 1];
      const item = (bullet ?? number)![1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export function AgreementText({ body }: { body: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#333]">
      {parse(body).map((b, i) => {
        if (b.kind === "heading") {
          return (
            <h2 key={i} className="pt-2 text-base font-bold text-brand print:text-black">
              {b.text}
            </h2>
          );
        }
        if (b.kind === "paragraph") return <p key={i}>{b.text}</p>;
        const List = b.kind === "bullets" ? "ul" : "ol";
        return (
          <List key={i} className={`space-y-1 pl-5 ${b.kind === "bullets" ? "list-disc" : "list-decimal"}`}>
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
