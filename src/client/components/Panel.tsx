import type { ReactNode } from "react";
import "./components.css";

interface PanelProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, subtitle, actions, footer, className, children }: PanelProps) {
  return (
    <section className={`panel ${className ?? ""}`} aria-label={title}>
      <header className="panel__header">
        <div className="panel__titles">
          <h2 className="panel__title">{title}</h2>
          {subtitle && <div className="panel__subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="panel__actions">{actions}</div>}
      </header>
      <div className="panel__body">{children}</div>
      {footer && <footer className="panel__footer">{footer}</footer>}
    </section>
  );
}

export function PanelState({ status, message }: { status: "loading" | "error" | "empty"; message?: string }) {
  return (
    <div className={`panel-state panel-state--${status}`} role={status === "error" ? "alert" : "status"}>
      {status === "loading" && <span className="spinner" aria-hidden="true" />}
      <span>{message ?? (status === "loading" ? "Loading…" : status === "error" ? "Couldn’t load this data." : "No data.")}</span>
    </div>
  );
}
