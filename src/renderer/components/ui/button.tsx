import type { ButtonHTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = ({ className, variant = "secondary", ...props }: ButtonProps): ReactElement => {
  return <button className={cn("ui-button", `ui-button-${variant}`, className)} {...props} />;
};
