import type { ReactElement } from "react";

const rows = [
  { prefix: "$", text: "pnpm dev" },
  { prefix: "vite", text: "renderer ready at localhost:5173" },
  { prefix: "agent", text: "Mastra boundary running in stub mode" },
  { prefix: "check", text: "inline Chat / Design / Code workspace mounted" }
];

export const Terminal = (): ReactElement => {
  return (
    <div className="ai-terminal" aria-label="Terminal output">
      {rows.map((row) => (
        <div className="ai-terminal-row" key={`${row.prefix}-${row.text}`}>
          <span>{row.prefix}</span>
          <code>{row.text}</code>
        </div>
      ))}
    </div>
  );
};
