import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const metadata: Metadata = {
  title: "Concerns",
};

export default function ConcernsPage() {
  return (
    <div>
      <PageHeader
        title="Concerns"
        description="Submit and track your academic or administrative concerns."
      >
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Submit New Concern
        </Button>
      </PageHeader>

      {/* Concerns List */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              No concerns submitted yet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Your submitted concerns will appear here as cards. Click
              &quot;Submit New Concern&quot; to create one.
            </p>
          </CardContent>
        </Card>
        {/* TODO: Map concern records into individual concern cards with status badges */}
      </div>
    </div>
  );
}
