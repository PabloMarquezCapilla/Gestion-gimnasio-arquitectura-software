import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, action, id }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 id={id}>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </header>
  );
}
