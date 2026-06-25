import type { HTMLAttributes, ReactElement, Ref } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export const Conversation = ({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement => {
  return <section className={cn("ai-conversation", className)} {...props} />;
};

type ConversationContentProps = HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };

export const ConversationContent = ({ className, ...props }: ConversationContentProps): ReactElement => {
  return <div className={cn("ai-conversation-content", className)} {...props} />;
};

export const ConversationScrollButton = (): ReactElement => {
  return (
    <Button className="ai-scroll-button" type="button" variant="icon" aria-label="Scroll to latest message">
      <ArrowDown size={15} />
    </Button>
  );
};
