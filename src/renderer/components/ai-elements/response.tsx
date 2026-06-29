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
  // Open links in the user's real browser, not a child Electron window. We
  // intercept the click and hand the URL to the OS (main also denies popups as a
  // safety net), so target="_blank" never spawns an in-app window.
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        if (href) {
          void window.plugins.openExternal(href);
        }
      }}
      {...props}
    >
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
