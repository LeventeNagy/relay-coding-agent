import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/utils";

interface MessageProps extends HTMLAttributes<HTMLElement> {
  from: "user" | "assistant" | "system";
}

export const Message = ({ className, from, ...props }: MessageProps): ReactElement => {
  return <article className={cn("ai-message", `ai-message-${from}`, className)} {...props} />;
};

export const MessageContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement => {
  return <div className={cn("ai-message-content", className)} {...props} />;
};

export const MessageResponse = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): ReactElement => {
  return <p className={cn("ai-message-response", className)} {...props} />;
};
