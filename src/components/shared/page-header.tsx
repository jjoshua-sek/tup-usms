interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode; // For action buttons on the right
}

/**
 * Consistent page header used across all pages.
 * Accepts optional children for action buttons (e.g., "Submit New Concern").
 */
export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2 mt-2 sm:mt-0">{children}</div>}
    </div>
  );
}
