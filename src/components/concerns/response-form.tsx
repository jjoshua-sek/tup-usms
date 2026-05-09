"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";

import { addConcernResponse } from "@/app/(student)/concerns/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface ResponseFormProps {
  concernId: string;
  /** What to call the user posting the reply (visible in placeholder) */
  responderRole: "student" | "staff";
  disabled?: boolean;
}

export function ResponseForm({
  concernId,
  responderRole,
  disabled,
}: ResponseFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!text.trim()) return;

    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("response_text", text);

      const result = await addConcernResponse(concernId, formData);

      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success("Reply sent");
      setText("");
      formRef.current?.reset();
      router.refresh();
    });
  };

  if (disabled) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">
          This concern is closed. No further replies can be added.
        </p>
      </div>
    );
  }

  const placeholderByRole =
    responderRole === "staff"
      ? "Provide a response, ask for clarification, or post a status update..."
      : "Reply or add more context to your concern...";

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="response_text" className="text-sm font-medium">
          {responderRole === "staff" ? "Staff response" : "Add a reply"}
        </Label>
        <Textarea
          id="response_text"
          name="response_text"
          rows={4}
          placeholder={placeholderByRole}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={10000}
          disabled={isPending}
          required
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{text.length} / 10,000 characters</span>
          {error && <span className="text-destructive">{error}</span>}
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || !text.trim()}
          className="bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Send reply
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
