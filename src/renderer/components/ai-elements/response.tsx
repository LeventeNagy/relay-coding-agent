import type { ReactElement, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";

interface ResponseProps {
  children: string;
}

/** Flatten React children to a string (code fences hold plain text nodes). */
const toText = (children: ReactNode): string => {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(toText).join("");
  }
  return "";
};

const components: Components = {
  // Block code lives in <pre><code>; pass the <pre> through so our CodeBlock
  // (which renders its own <pre>) isn't nested inside another one.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }) => {
    const text = toText(children).replace(/\n$/, "");
    const match = /language-([\w-]+)/.exec(className ?? "");
    const isBlock = Boolean(match) || text.includes("\n");
    if (isBlock) {
      return <CodeBlock language={match?.[1]} code={text} />;
    }
    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    );
  },
  a: ({ children, ...props }) => (
    <a target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  )
};

/** Renders assistant markdown (GFM) with copyable, highlighted code blocks. */
export const Response = ({ children }: ResponseProps): ReactElement => {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
};
