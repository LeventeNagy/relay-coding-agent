import type { FormHTMLAttributes, ReactElement, TextareaHTMLAttributes } from "react";
import { SendHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export const PromptInput = ({ className, ...props }: FormHTMLAttributes<HTMLFormElement>): ReactElement => {
  return <form className={cn("ai-prompt-input", className)} {...props} />;
};

export const PromptInputTextarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement => {
  return <Textarea className={cn("ai-prompt-textarea", className)} {...props} />;
};

interface PromptInputSubmitProps {
  disabled?: boolean;
  isLoading?: boolean;
}

export const PromptInputSubmit = ({ disabled, isLoading }: PromptInputSubmitProps): ReactElement => {
  return (
    <Button type="submit" disabled={disabled || isLoading} variant="primary" className="ai-prompt-submit" aria-label="Send prompt">
      <SendHorizontal size={16} />
    </Button>
  );
};
