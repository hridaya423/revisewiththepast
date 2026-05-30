"use client";

import { Fragment } from "react";
import { BlockMath, InlineMath } from "react-katex";

type Segment =
  | { type: "text"; value: string }
  | { type: "inline-math"; value: string }
  | { type: "block-math"; value: string };

function parseMathSegments(input: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g;
  let lastIndex = 0;

  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: input.slice(lastIndex, index) });
    }

    const token = match[0];
    if (token.startsWith("$$") && token.endsWith("$$")) {
      segments.push({ type: "block-math", value: token.slice(2, -2).trim() });
    } else if (token.startsWith("\\[") && token.endsWith("\\]")) {
      segments.push({ type: "block-math", value: token.slice(2, -2).trim() });
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      segments.push({ type: "inline-math", value: token.slice(2, -2).trim() });
    } else if (token.startsWith("$") && token.endsWith("$")) {
      segments.push({ type: "inline-math", value: token.slice(1, -1).trim() });
    } else {
      segments.push({ type: "text", value: token });
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", value: input.slice(lastIndex) });
  }

  return segments;
}

function renderTextWithBreaks(value: string, keyPrefix: string) {
  return value.split("\n").map((line, index, lines) => (
    <Fragment key={`${keyPrefix}-${index}`}>
      {line}
      {index < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

export function MathRichText({ text, className = "" }: { text: string; className?: string }) {
  const segments = parseMathSegments(text);

  return (
    <div className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "block-math") {
          return (
            <div key={`block-${index}`} className="my-3 overflow-x-auto rounded-lg bg-white/65 px-3 py-2">
              <BlockMath math={segment.value} renderError={() => <span className="font-mono text-[0.85em]">{segment.value}</span>} />
            </div>
          );
        }

        if (segment.type === "inline-math") {
          return (
            <InlineMath key={`inline-${index}`} math={segment.value} renderError={() => <span className="font-mono text-[0.9em]">{segment.value}</span>} />
          );
        }

        return <Fragment key={`text-${index}`}>{renderTextWithBreaks(segment.value, `text-${index}`)}</Fragment>;
      })}
    </div>
  );
}
