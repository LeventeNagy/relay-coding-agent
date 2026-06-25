import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/utils";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement => {
  return <div className={cn("ui-card", className)} {...props} />;
};

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement => {
  return <div className={cn("ui-card-header", className)} {...props} />;
};

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): ReactElement => {
  return <h2 className={cn("ui-card-title", className)} {...props} />;
};

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement => {
  return <div className={cn("ui-card-content", className)} {...props} />;
};
