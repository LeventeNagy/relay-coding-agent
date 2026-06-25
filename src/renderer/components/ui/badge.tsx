import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/utils";

type BadgeTone = "thinking" | "read" | "edit" | "grep" | "done" | "neutral";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export const Badge = ({ className, tone = "neutral", ...props }: BadgeProps): ReactElement => {
  return <span className={cn("ui-badge", `ui-badge-${tone}`, className)} {...props} />;
};
