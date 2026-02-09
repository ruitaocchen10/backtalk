"use client";

import { useState, useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AppSidebar } from "@/components/AppSidebar";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

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

  const handleCreateConversation = async () => {
    // Clear any previous errors
    setError("");

    // Basic YouTube URL validation
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    if (!youtubeUrl.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }
    if (!youtubeRegex.test(youtubeUrl.trim())) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    setIsCreating(true);

    try {
      // Get the user's JWT token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("Authentication required. Please log in again.");
        setIsCreating(false);
        router.push("/login");
        return;
      }

      // Call the backend API to create conversation
      const response = await fetch("http://localhost:8000/api/conversations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          youtube_url: youtubeUrl.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();

      // Navigate to the conversation page
      router.push(`/conversation/${data.conversation_id}`);

    } catch (err) {
      console.error("Error creating conversation:", err);
      setError(err instanceof Error ? err.message : "Failed to create conversation. Please try again.");
      setIsCreating(false);
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar userEmail={user?.email} />

      <SidebarInset>
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-xl space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold">Start a New Conversation</h1>
              <p className="text-muted-foreground">
                Enter a YouTube video URL to begin analyzing and discussing its content
              </p>
            </div>

            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="youtube-url">YouTube URL</FieldLabel>
                <Input
                  id="youtube-url"
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  disabled={isCreating}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isCreating) {
                      handleCreateConversation();
                    }
                  }}
                />
              </Field>

              {error && (
                <div className="text-sm text-red-500 text-center">
                  {error}
                </div>
              )}

              <Button
                onClick={handleCreateConversation}
                disabled={isCreating}
                className="w-full"
                size="lg"
              >
                {isCreating ? "Creating Conversation..." : "Create Conversation"}
              </Button>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
