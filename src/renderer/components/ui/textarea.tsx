import type { ReactElement, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement => {
  return <textarea className={cn("ui-textarea", className)} {...props} />;
};
