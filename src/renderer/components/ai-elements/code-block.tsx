import { memo, useState, type ReactElement } from "react";
import { Check, Copy } from "lucide-react";
import hljs from "highlight.js/lib/common";

interface CodeBlockProps {
  language?: string;
  code: string;
}

/** Highlight code, falling back to auto-detection when the language is unknown. */
const highlight = (code: string, language?: string): string => {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language }).value;
  }
  return hljs.highlightAuto(code).value;
};

/**
 * A fenced code (or markdown) block: language label + Copy button over a
 * syntax-highlighted, horizontally-scrollable body. Memoized so streaming only
 * re-highlights the block that is currently growing.
 */
const CodeBlockBase = ({ language, code }: CodeBlockProps): ReactElement => {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-block-lang">{language || "text"}</span>
        <button type="button" className="code-block-copy" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code
          className="hljs"
          dangerouslySetInnerHTML={{ __html: highlight(code, language) }}
        />
      </pre>
    </div>
  );
};

export const CodeBlock = memo(CodeBlockBase);
