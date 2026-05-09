"use client";

import { useState } from "react";
import { Shield, Lock, Eye, FileCheck, ChevronRight } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface DpaConsentDialogProps {
  trigger: React.ReactNode;
  /** Called when student clicks "I understand and agree" */
  onAccept: () => void;
}

/**
 * Data Privacy Act consent dialog (RA 10173).
 *
 * Per the National Privacy Commission, consent must be:
 * - Freely given (no service deprivation for refusal — though here, refusal
 *   means they can't enroll, which is unavoidable for a registration system)
 * - Specific (lists what data we collect, why, and who sees it)
 * - Informed (plain language, not legalese)
 * - Unambiguous (explicit "I agree" button, not pre-checked)
 *
 * The acceptance event is timestamped + IP-logged via the audit_logs table
 * (handled by the calling Server Action).
 */
export function DpaConsentDialog({ trigger, onAccept }: DpaConsentDialogProps) {
  const [open, setOpen] = useState(false);

  const handleAccept = () => {
    onAccept();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-primary/10 p-2">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="font-display">
                Data Privacy Act Notice
              </DialogTitle>
              <DialogDescription>
                Republic Act No. 10173 — please read before consenting
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <p className="text-balance">
            Under the Data Privacy Act of 2012, the Technological University
            of the Philippines &mdash; Manila is required to obtain your
            informed consent before collecting and processing your personal
            information.
          </p>

          {/* What we collect */}
          <Section
            icon={FileCheck}
            title="Data we collect"
            items={[
              "Identity: name, birth date, gender, citizenship, religion",
              "Contact: address, phone number, email address",
              "Academic: program, year level, grades, evaluations",
              "Family background: financial support, beneficiary statuses (PWD, IP, Listahanan)",
              "Photo (for ID generation and profile display)",
            ]}
          />

          {/* How we use it */}
          <Section
            icon={Lock}
            title="How we use your data"
            items={[
              "Enrollment, scheduling, and grade reporting",
              "Concern submission and response, including AI summarization for staff routing",
              "Government-mandated reports (CHED, NPC, NCIP, DSWD)",
              "Communication about academic matters",
            ]}
          />

          {/* Who sees it */}
          <Section
            icon={Eye}
            title="Who sees your data"
            items={[
              "You: full access to your own records",
              "TUP-Manila staff and faculty: only as needed for their roles",
              "Authorized government agencies: for mandated reports only",
              "Anthropic (AI provider): your concern text is sent for summarization, then immediately discarded — not retained or used for training",
            ]}
          />

          {/* Your rights */}
          <Section
            icon={Shield}
            title="Your rights under RA 10173"
            items={[
              "Access, correct, or delete your personal data at any time",
              "Withdraw your consent (terminates your USMS account)",
              "File complaints with the National Privacy Commission",
              "Be informed of any data breach affecting your information",
            ]}
          />

          <Separator />

          <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-xs">
            <p>
              <strong>Data retention:</strong> 5 years after graduation, then
              archived per CHED requirements.
            </p>
            <p>
              <strong>Security:</strong> Row-level access controls, encrypted
              transport (HTTPS), audit logging of all data access.
            </p>
            <p>
              <strong>Data Protection Officer:</strong>{" "}
              <a
                href="mailto:dpo@tup.edu.ph"
                className="text-primary hover:underline"
              >
                dpo@tup.edu.ph
              </a>
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Decline
          </Button>
          <Button
            type="button"
            onClick={handleAccept}
            className="bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
          >
            I understand and agree
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SectionProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: string[];
}

function Section({ icon: Icon, title, items }: SectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      </div>
      <ul className="space-y-1 ml-5 list-disc text-sm">
        {items.map((item, i) => (
          <li key={i} className="text-balance">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
