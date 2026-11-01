import { useState, type ReactNode } from "react";

interface SectionProps {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Section({ title, badge, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <button className="section-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`chevron${open ? " open" : ""}`} aria-hidden>▸</span>
        <span className="section-title">{title}</span>
        {badge !== undefined && <span className="badge">{badge}</span>}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
