"use client";

import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Home as HomeIcon,
  LayoutDashboard,
  Settings,
  Users,
  FileText,
  Bell,
  HelpCircle,
} from "lucide-react";
import { useAudioCapture } from "@/hooks/useAudioCapture";

export default function Home() {
  const { isRecording, start, stop } = useAudioCapture();
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  const handleClick = () => {
    if (isRecording) {
      stop();
      setTranscript("");
      setInterimTranscript("");
    } else {
      start(
        (chunk) => {
          console.log("Got PCM chunk:", chunk.byteLength, "bytes");
          // Should log 8000 bytes each time (4000 Int16 samples × 2 bytes)
        },
        (text, isFinal) => {
          if (isFinal) {
            // Append final transcript to the accumulated text
            setTranscript((prev) => prev + " " + text);
            setInterimTranscript("");
          } else {
            // Show interim results separately
            setInterimTranscript(text);
          }
        },
      );
    }
  };

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <a href="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <HomeIcon />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">BackTalk</span>
                    <span className="text-xs">v1.0.0</span>
                  </div>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive>
                    <a href="/">
                      <HomeIcon />
                      <span>Home</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/dashboard">
                      <LayoutDashboard />
                      <span>Dashboard</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/users">
                      <Users />
                      <span>Users</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/documents">
                      <FileText />
                      <span>Documents</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/notifications">
                      <Bell />
                      <span>Notifications</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Other</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/settings">
                      <Settings />
                      <span>Settings</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/help">
                      <HelpCircle />
                      <span>Help</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/profile">
                  <Users />
                  <span>Profile</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <div className="flex items-center gap-2">
            <span className="font-semibold">Welcome to BackTalk</span>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 sm:items-start">
            <div>
              <Field>
                <FieldLabel htmlFor="input-field-link">Youtube Link</FieldLabel>
                <Input
                  id="input-field-link"
                  type="text"
                  placeholder="Paste your Youtube Link"
                />
              </Field>
              <Button>Create Chatroom</Button>
              <div className="mt-4 space-y-4">
                <button
                  onClick={handleClick}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {isRecording ? "Stop Recording" : "Start Recording"}
                </button>

                {isRecording && (
                  <div className="p-4 border rounded-lg bg-gray-50">
                    <h3 className="font-semibold mb-2">Live Transcription:</h3>
                    <p className="text-gray-800">{transcript}</p>
                    {interimTranscript && (
                      <p className="text-gray-400 italic">
                        {interimTranscript}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
