"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { AppSidebar } from "@/components/AppSidebar";

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading } = useAuth();
  const conversationId = params.id as string;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Show nothing while checking auth status
  if (loading || !user) {
    return null;
  }

  return (
    <SidebarProvider>
      <AppSidebar
        currentConversationId={conversationId}
        userEmail={user?.email}
      />

      <SidebarInset>
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold">Conversation Page</h1>
            <p className="text-muted-foreground">
              Conversation ID: {conversationId}
            </p>
            <p className="text-sm text-muted-foreground">
              (Full conversation UI will be implemented next)
            </p>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
