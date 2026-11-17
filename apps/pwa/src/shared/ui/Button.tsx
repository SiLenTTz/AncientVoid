import type { ComponentChildren, ComponentProps } from "preact";


/**
 * EPIC-P63 T63.7: Druckknopf-Baustein. Varianten sind die einzige Stellschraube —
 * keine Props für freie Farben (docs/design-system.md §Bausteine). Stile:
 * styles/ui/button.css; die Zielhöhe folgt --target/--icon-target.
 */
export interface ButtonProps extends Omit<Omit<ComponentProps<"button">, "class" | "size">, "class" | "size"> {
  /** primary: gefüllt mit Akzent · subtle: ruhige Fläche · danger: destruktiv · link: Textstelle */
  variant?: "primary" | "subtle" | "danger" | "link";
  size?: "md" | "sm";
  /** Reine Symbol-Taste (⧉, ×, ➤): quadratisch, Zielgröße --icon-target. */
  icon?: boolean;
  class?: string;
  children?: ComponentChildren;
}

export function Button({ variant, size = "md", icon, class: cls, children, ...rest }: ButtonProps) {
  const classes = ["ui-button", variant ? `ui-button--${variant}` : null, size === "sm" ? "ui-button--sm" : null, icon ? "ui-button--icon" : null, cls].filter(Boolean);
  return (
    <button type="button" class={classes.join(" ")} {...rest}>
      {children}
    </button>
  );
}
