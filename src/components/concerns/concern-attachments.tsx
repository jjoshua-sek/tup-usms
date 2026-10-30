import { ArrowSquareOutIcon as ExternalLink, FileTextIcon as FileText, ImageIcon } from "@phosphor-icons/react/ssr";

import type { ConcernAttachment } from "@/lib/concerns/attachments";
import { formatBytes } from "@/lib/images/compress";

/**
 * The files attached to a concern, for the student's page and the staff
 * review page alike. Each one links to the route that signs a fresh,
 * short-lived URL on click (app/api/concerns/attachments/[id]), so the
 * links on a long-open page never go stale.
 */
export function ConcernAttachments({ attachments }: { attachments: ConcernAttachment[] }) {
  return (
    <ul className="space-y-1">
      {attachments.map((attachment) => {
        const Icon = attachment.mime_type === "application/pdf" ? FileText : ImageIcon;
        return (
          <li key={attachment.id}>
            <a
              href={`/api/concerns/attachments/${attachment.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate group-hover:underline">{attachment.file_name}</span>
              <span className="ml-auto shrink-0 font-mono text-muted-foreground">
                {formatBytes(attachment.file_size)}
              </span>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
