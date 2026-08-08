import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "ghost" | "danger" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Only meaningful with variant="icon" - hover turns loss-red (matches the
   * old .idash button.icon-btn.danger pattern, e.g. a delete icon button). */
  danger?: boolean;
}

// Shared button using the design-system's .ds-btn classes (tokens.css) -
// unifies what used to be the .idash button.primary/.ghost/.icon-btn
// classNames scattered across the dashboard.
export function Button({ variant = "primary", danger, type = "button", className, ...rest }: ButtonProps) {
  const classes =
    variant === "icon"
      ? ["ds-btn-icon", danger ? "ds-danger" : "", className].filter(Boolean).join(" ")
      : ["ds-btn", `ds-btn-${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
