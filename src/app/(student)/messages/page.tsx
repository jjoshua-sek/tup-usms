import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = {
  title: "Messages",
};

export default function MessagesPage() {
  return (
    <div>
      <PageHeader
        title="Messages"
        description="Communicate with faculty and staff."
      />

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="trash">Trash</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Your inbox is empty. Incoming messages from faculty and staff
                will appear here.
              </p>
              {/* TODO: List inbox messages with sender, subject, date, and read status */}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compose">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Compose message form will be rendered here with recipient
                selector, subject, and rich text editor.
              </p>
              {/* TODO: Implement compose form with recipient picker and message body */}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drafts">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                No drafts saved. Messages you start composing but don&apos;t
                send will be saved here.
              </p>
              {/* TODO: List draft messages */}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sent">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                No sent messages. Messages you have sent will appear here.
              </p>
              {/* TODO: List sent messages with recipient, subject, and date */}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trash">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Trash is empty. Deleted messages will appear here.
              </p>
              {/* TODO: List trashed messages with restore/permanent delete actions */}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
