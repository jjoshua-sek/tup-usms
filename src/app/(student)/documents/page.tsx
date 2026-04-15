import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload } from "lucide-react";

export const metadata: Metadata = {
  title: "Documents",
};

export default function DocumentsPage() {
  return (
    <div>
      <PageHeader
        title="Documents"
        description="Upload and manage your academic documents."
      />

      {/* Drag-and-Drop Upload Area */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
            <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drag and drop files here, or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Supported formats: PDF, JPG, PNG (max 10MB)
            </p>
          </div>
          {/* TODO: Implement drag-and-drop file upload with progress indicator */}
        </CardContent>
      </Card>

      {/* File List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Uploaded Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No documents uploaded yet. Your uploaded files will appear here with
            download and delete options.
          </p>
          {/* TODO: List uploaded documents with file name, size, date, and actions */}
        </CardContent>
      </Card>
    </div>
  );
}
