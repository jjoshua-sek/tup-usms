import type { Metadata } from "next";
import { Send } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Messages",
};

export default function StaffMessagesPage() {
  return (
    <div>
      <PageHeader
        title="Messages"
        description="Send and manage messages to individual students or batch groups."
      >
        <Button size="sm">
          <Send className="mr-1.5 h-4 w-4" />
          Batch Send
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- Conversation List ---------- */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Conversations</CardTitle>
            <CardDescription>Select a thread to view.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Search messages..." className="mb-3" />
            <p className="text-sm text-muted-foreground">
              No conversations yet. Messages from students will appear here.
            </p>
          </CardContent>
        </Card>

        {/* ---------- Message Thread ---------- */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Thread</CardTitle>
            <CardDescription>
              Select a conversation to view its messages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed bg-muted/50 text-sm text-muted-foreground">
              Select a conversation from the left panel to view the message
              thread.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Batch Send Info ---------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Batch Send</CardTitle>
          <CardDescription>
            Send a message to multiple students at once based on filters
            (program, year level, section, or a custom list).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the &quot;Batch Send&quot; button above to compose a message and
            select recipients by group or individually.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
