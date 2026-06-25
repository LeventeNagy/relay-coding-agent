import type { ReactElement } from "react";
import { ChevronRight, FileCode2, FolderClosed } from "lucide-react";

const files = [
  { name: "src", type: "folder", depth: 0 },
  { name: "renderer/App.tsx", type: "file", depth: 1 },
  { name: "mastra/agentService.ts", type: "file", depth: 1 },
  { name: "shared/agent/types.ts", type: "file", depth: 1 },
  { name: "DESIGN.md", type: "file", depth: 0 }
] as const;

export const FileTree = (): ReactElement => {
  return (
    <div className="ai-file-tree" aria-label="Project file tree">
      {files.map((file) => (
        <div className="ai-file-row" key={file.name} style={{ paddingLeft: 10 + file.depth * 14 }}>
          {file.type === "folder" ? <ChevronRight size={13} /> : <span className="ai-file-spacer" />}
          {file.type === "folder" ? <FolderClosed size={14} /> : <FileCode2 size={14} />}
          <span>{file.name}</span>
        </div>
      ))}
    </div>
  );
};
