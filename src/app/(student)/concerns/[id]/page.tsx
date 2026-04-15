import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "Concern Detail",
};

export default async function ConcernDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <PageHeader
        title="Concern Detail"
        description={`Viewing concern #${id}`}
      />

      {/* Full Concern Text */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Concern</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The full concern text will be displayed here.
          </p>
          {/* TODO: Fetch and display full concern content by ID */}
        </CardContent>
      </Card>

      {/* AI Summary */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">AI Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            An AI-generated summary of this concern will appear here to help
            staff quickly understand the issue.
          </p>
          {/* TODO: Display AI-generated summary of the concern */}
        </CardContent>
      </Card>

      {/* Response Thread */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Responses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              No responses yet. Staff replies will appear here as a threaded
              conversation.
            </p>
            <Separator />
            <p className="text-sm text-muted-foreground">
              Reply form will be rendered here.
            </p>
          </div>
          {/* TODO: Implement response thread with chronological messages */}
        </CardContent>
      </Card>
    </div>
  );
}
