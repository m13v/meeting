"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";

import { OpenAI } from "openai";
import { useSettings } from "@/lib/hooks/use-settings";
import ReactMarkdown from "react-markdown";
import {
  X,
  Copy,
  RefreshCw,
  Trash2,
  FileText,
  PlusCircle,
  ChevronDown,
  Pencil,
  Save,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";
import localforage from "localforage";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "./ui/input";
import { keysToCamelCase } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "./ui/checkbox";
import { pipe } from "@screenpipe/browser";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "./ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Color } from "@tiptap/extension-color";
import ListItem from "@tiptap/extension-list-item";
import TextStyle from "@tiptap/extension-text-style";
import { EditorProvider } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

function formatDate(date: string): string {
  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = dateObj.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formattedDate} at ${formattedTime}`;
}

async function setItem(key: string, value: any): Promise<void> {
  try {
    if (typeof window !== "undefined") {
      console.log("storing to localforage:", key, value);
      await localforage.setItem(key, value);
      // Verify the save worked
      const saved = await localforage.getItem(key);
      console.log("verified save:", key, saved);
    }
  } catch (error) {
    console.error("error setting item in storage:", error);
    throw error;
  }
}

async function getItem(key: string): Promise<any> {
  try {
    if (typeof window !== "undefined") {
      return await localforage.getItem(key);
    }
  } catch (error) {
    console.error("error getting item from storage:", error);
    throw error;
  }
  return null;
}

interface MeetingSegment {
  timestamp: string;
  transcription: string;
  deviceName: string;
  deviceType: string;
  speaker: Speaker;
}

interface Meeting {
  meetingGroup: number;
  meetingStart: string;
  meetingEnd: string;
  fullTranscription: string;
  name: string | null;
  participants: string | null;
  summary: string | null;
  mergedWith?: number[]; // Array of meeting groups merged with this one
  selectedDevices: Set<string>;
  deviceNames: Set<string>;
  segments: MeetingSegment[];
}

interface Speaker {
  id: number;
  name: string;
}

interface AudioContent {
  chunkId: number;
  transcription: string;
  timestamp: string;
  filePath: string;
  offsetIndex: number;
  tags: string[];
  deviceName: string;
  deviceType: string;
  speaker: Speaker;
}

interface AudioTranscription {
  type: "Audio";
  content: AudioContent;
}

interface LiveMeeting {
  isRecording: boolean;
  startTime: string;
  transcription: string;
}

const extensions = [
  Color.configure({ types: [TextStyle.name, ListItem.name] }),
  // TextStyle.configure({ types: [ListItem.name] }),
  StarterKit.configure({
    bulletList: {
      keepMarks: true,
      keepAttributes: false,
    },
    orderedList: {
      keepMarks: true,
      keepAttributes: false,
    },
  }),
];

export function MeetingHistory() {
  const { settings } = useSettings();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const { toast } = useToast();
  const [showError, setShowError] = useState(false);
  const { copyToClipboard } = useCopyToClipboard({ timeout: 2000 });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [customSummaryPrompt, setCustomSummaryPrompt] = useState<string>(
    "please provide a concise summary of the following meeting transcript"
  );
  const [isClearing, setIsClearing] = useState(false);
  const [liveMeeting, setLiveMeeting] = useState<LiveMeeting | null>(null);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isStreamingAvailable, setIsStreamingAvailable] =
    useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMeetings();
  }, []);

  useEffect(() => {
    setShowError(!!error);
  }, [error]);

  useEffect(() => {
    const checkStreamingAvailability = async () => {
      try {
        const response = await fetch(
          "http://localhost:3030/sse/transcriptions",
          {
            method: "HEAD",
          }
        );
        setIsStreamingAvailable(response.ok);
      } catch (error) {
        setIsStreamingAvailable(false);
      }
    };

    // Initial check
    checkStreamingAvailability();

    // Poll every 5 seconds
    const interval = setInterval(checkStreamingAvailability, 5000);

    return () => clearInterval(interval);
  }, []);

  async function loadMeetings() {
    setIsLoading(true);
    try {
      console.log("loading meetings from storage");
      const storedMeetings = await getItem("meetings");
      console.log("loaded meetings:", storedMeetings);
      if (storedMeetings) {
        setMeetings(storedMeetings);
      }
      await fetchMeetings();
    } catch (err) {
      console.error("failed to load meetings:", err);
      setError("failed to load meetings");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchMeetings() {
    console.log("fetching meetings...");
    setLoading(true);
    try {
      // Get current meetings from state AND storage to ensure we have everything
      const storedMeetings = (await getItem("meetings")) || [];
      const currentMeetings = [...meetings, ...storedMeetings];

      // Filter unique meetings by meetingGroup
      const uniqueMeetings = Array.from(
        new Map(currentMeetings.map((m) => [m.meetingGroup, m])).values()
      );

      const liveRecordings = uniqueMeetings.filter((m) =>
        Array.from(m.deviceNames).includes("live recording")
      );

      // Always fetch from the last 7x24 hours
      const startTime = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();
      console.log("searching from:", startTime);

      const response = await fetch(
        `http://localhost:3030/search?content_type=audio&start_time=${startTime}&limit=1000`
      );
      if (!response.ok) {
        throw new Error("failed to fetch meeting history");
      }
      const result = await response.json();
      const camelCaseResult = keysToCamelCase<{ data: AudioTranscription[] }>(
        result
      );
      console.log("fetch result:", camelCaseResult);
      const newMeetings = processMeetings(camelCaseResult.data);
      console.log("processed new meetings:", newMeetings);

      // Merge new meetings with stored meetings, preserving edited content
      const mergedMeetings = newMeetings.map((newMeeting) => {
        const existingMeeting = uniqueMeetings.find(
          (m) => m.meetingGroup === newMeeting.meetingGroup
        );
        // If meeting exists and has edited content, preserve it
        if (existingMeeting) {
          return {
            ...newMeeting,
            segments: existingMeeting.segments,
            fullTranscription: existingMeeting.fullTranscription,
            summary: existingMeeting.summary,
            name: existingMeeting.name,
            participants: existingMeeting.participants,
          };
        }
        return newMeeting;
      });

      // Combine live recordings with merged meetings
      const updatedMeetings = [...liveRecordings, ...mergedMeetings];

      // Sort meetings by start time (descending)
      updatedMeetings.sort(
        (a, b) =>
          new Date(b.meetingStart).getTime() -
          new Date(a.meetingStart).getTime()
      );

      setMeetings(updatedMeetings);
      await setItem("meetings", updatedMeetings);
    } catch (err) {
      setError(
        "some trouble fetching new meetings. please check health status."
      );
      console.error("fetch error:", err);
    } finally {
      console.log("fetch completed");
      setLoading(false);
    }
  }

  async function generateSummary(meeting: Meeting) {
    pipe.captureMainFeatureEvent("meeting-history", {
      action: "generate-summary",
    });
    setIsSummarizing(true);

    try {
      const openai = new OpenAI({
        apiKey:
          settings.aiProviderType === "screenpipe-cloud"
            ? settings.user.token
            : settings.openaiApiKey,
        baseURL: settings.aiUrl,
        dangerouslyAllowBrowser: true,
      });

      const model = settings.aiModel;

      // create an enhanced prompt that includes identified participants
      const enhancedPrompt = meeting.participants
        ? `${customSummaryPrompt}\n\nparticipants: ${meeting.participants}`
        : customSummaryPrompt;

      const messages = [
        {
          role: "user" as const, // claude does not support system messages?
          content: `you are a helpful assistant that summarizes meetings. `,
        },
        {
          role: "user" as const,
          content: `${enhancedPrompt}:\n\n${meeting.segments
            .map((s) => s.transcription)
            .join("\n")}`,
        },
      ];

      const stream = await openai.chat.completions.create({
        model: model,
        messages: messages,
        stream: true,
      });

      let summary = "";
      const updatedMeeting = { ...meeting, summary: "" };

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        summary += content;
        updatedMeeting.summary = summary;

        // update the meeting with the new summary
        const updatedMeetings = meetings.map((m) =>
          m.meetingGroup === meeting.meetingGroup ? updatedMeeting : m
        );
        setMeetings(updatedMeetings);
      }

      // final update after streaming is complete
      const finalUpdatedMeetings = meetings.map((m) =>
        m.meetingGroup === meeting.meetingGroup ? updatedMeeting : m
      );
      setMeetings(finalUpdatedMeetings);

      try {
        console.log("updating meetings state...");
        setMeetings(finalUpdatedMeetings);

        console.log("storing meetings in storage...");
        await setItem("meetings", finalUpdatedMeetings);

        console.log("storage operation completed");

        toast({
          title: "summary generated",
          description:
            "the meeting summary has been created and saved successfully.",
        });
      } catch (storageError) {
        console.error("error updating storage:", storageError);
        toast({
          title: "warning",
          description:
            "summary generated but couldn't be saved due to storage limits. older meetings might be removed to make space.",
          variant: "destructive",
        });

        // attempt to remove older meetings to make space
        try {
          const oldMeetings = (await getItem("meetings")) || [];
          const meetingsToKeep = oldMeetings.slice(-10); // keep only the last 10 meetings
          await setItem("meetings", meetingsToKeep);
          setMeetings(meetingsToKeep);
          toast({
            title: "storage cleaned",
            description:
              "older meetings were removed to make space for new ones.",
          });
        } catch (cleanupError) {
          console.error("failed to clean up storage:", cleanupError);
          toast({
            title: "error",
            description:
              "failed to clean up storage. please clear your browser data manually.",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error("error generating summary:", error);
      toast({
        title: "error",
        description: "failed to generate meeting summary. please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSummarizing(false);
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  function processMeetings(transcriptions: AudioTranscription[]): Meeting[] {
    console.log("processing transcriptions:", transcriptions);
    let meetings: Meeting[] = [];
    let currentMeeting: Meeting | null = null;
    let meetingGroup = 0;

    // sort transcriptions by timestamp
    transcriptions.sort(
      (a, b) =>
        new Date(a.content.timestamp).getTime() -
        new Date(b.content.timestamp).getTime()
    );

    transcriptions.forEach((trans, index) => {
      const currentTime = new Date(trans.content.timestamp);
      const prevTime =
        index > 0
          ? new Date(transcriptions[index - 1].content.timestamp)
          : null;

      // Get speaker name based on speaker info or device type
      const speakerName =
        trans.content.speaker?.name && trans.content.speaker.name.length > 0
          ? trans.content.speaker.name
          : trans.content.deviceType?.toLowerCase() === "input"
          ? "you"
          : trans.content.deviceType?.toLowerCase() === "output"
          ? "others"
          : "unknown";

      if (
        !currentMeeting ||
        (prevTime &&
          currentTime.getTime() - prevTime.getTime() >= 5 * 60 * 1000) // increased to 5 minutes
      ) {
        if (currentMeeting) {
          meetings.push(currentMeeting);
        }
        meetingGroup++;
        currentMeeting = {
          meetingGroup: meetingGroup,
          meetingStart: trans.content.timestamp,
          meetingEnd: trans.content.timestamp,
          fullTranscription: `${formatTimestamp(
            trans.content.timestamp
          )} [${speakerName}] ${trans.content.transcription}\n`,
          name: null,
          participants: null,
          summary: null,
          selectedDevices: new Set([trans.content.deviceName]),
          segments: [
            {
              timestamp: trans.content.timestamp,
              transcription: trans.content.transcription,
              deviceName: trans.content.deviceName,
              deviceType: trans.content.deviceType,
              speaker: trans.content.speaker || {
                id: -1,
                name: speakerName,
              },
            },
          ],
          deviceNames: new Set([trans.content.deviceName]),
        };
      } else if (currentMeeting) {
        currentMeeting.meetingEnd = trans.content.timestamp;
        currentMeeting.fullTranscription += `${formatTimestamp(
          trans.content.timestamp
        )} [${speakerName}] ${trans.content.transcription}\n`;
        currentMeeting.selectedDevices.add(trans.content.deviceName);
        currentMeeting.segments.push({
          timestamp: trans.content.timestamp,
          transcription: trans.content.transcription,
          deviceName: trans.content.deviceName,
          deviceType: trans.content.deviceType,
          speaker: trans.content.speaker || {
            id: -1,
            name: speakerName,
          },
        });
        currentMeeting.deviceNames.add(trans.content.deviceName);
      }
    });

    if (currentMeeting) {
      meetings.push(currentMeeting);
    }

    // sort meetings by start time
    meetings.sort(
      (a, b) =>
        new Date(b.meetingStart).getTime() - new Date(a.meetingStart).getTime()
    );

    // remove duplicate meetings
    meetings = meetings.filter(
      (meeting, index, self) =>
        index === self.findIndex((t) => t.meetingGroup === meeting.meetingGroup)
    );

    console.log("processed meetings:", meetings);
    return meetings.filter(
      (m) => m.fullTranscription.replace(/\n/g, "").length >= 200
    );
  }

  // Memoize expensive computations
  const sortedMeetings = useMemo(() => {
    return [...meetings].sort(
      (a, b) =>
        new Date(b.meetingStart).getTime() - new Date(a.meetingStart).getTime()
    );
  }, [meetings]);

  const copyWithToast = (content: string, type: string) => {
    copyToClipboard(content);
    toast({
      title: "copied to clipboard",
      description: `${type} has been copied to your clipboard.`,
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchMeetings();
      toast({
        title: "meetings refreshed",
        description: "your meeting history has been updated.",
      });
    } catch (error) {
      console.error("error refreshing meetings:", error);
      toast({
        title: "refresh failed",
        description: "failed to refresh meetings. please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleClearMeetings = async () => {
    setIsClearing(true);
    try {
      await localforage.removeItem("meetings");
      setMeetings([]);
      toast({
        title: "meeting data cleared",
        description: "all stored meeting data has been removed.",
      });
    } catch (error) {
      console.error("error clearing meeting data:", error);
      toast({
        title: "error",
        description: "failed to clear meeting data. please try again.",
        variant: "destructive",
      });
    } finally {
      setIsClearing(false);
    }
  };

  const mergeMeetings = (index: number) => {
    const updatedMeetings = [...meetings];
    const currentMeeting = updatedMeetings[index];
    const nextMeeting = updatedMeetings[index + 1];

    const mergedMeeting: Meeting = {
      ...currentMeeting,
      meetingEnd: new Date(
        Math.max(
          new Date(currentMeeting.meetingEnd).getTime(),
          new Date(nextMeeting.meetingEnd).getTime()
        )
      ).toISOString(),
      meetingStart: new Date(
        Math.min(
          new Date(currentMeeting.meetingStart).getTime(),
          new Date(nextMeeting.meetingStart).getTime()
        )
      ).toISOString(),
      fullTranscription: `${currentMeeting.fullTranscription}\n${nextMeeting.fullTranscription}`,
      mergedWith: [
        ...(currentMeeting.mergedWith || []),
        nextMeeting.meetingGroup,
        ...(nextMeeting.mergedWith || []),
      ],
      segments: [...currentMeeting.segments, ...nextMeeting.segments],
      selectedDevices: new Set([
        ...Array.from(currentMeeting.selectedDevices),
        ...Array.from(nextMeeting.selectedDevices),
      ]),
    };

    // Remove both meetings and add the merged one
    updatedMeetings.splice(index, 2, mergedMeeting);

    // Re-sort meetings by start time
    updatedMeetings.sort(
      (a, b) =>
        new Date(b.meetingStart).getTime() - new Date(a.meetingStart).getTime()
    );

    setMeetings(updatedMeetings);
    setItem("meetings", updatedMeetings);
  };

  const handleDeviceToggle = useCallback(
    (meetingGroup: number, deviceName: string, isChecked: boolean) => {
      setMeetings((prevMeetings) => {
        return prevMeetings.map((meeting) => {
          if (meeting.meetingGroup === meetingGroup) {
            const updatedSelectedDevices = new Set(meeting.selectedDevices);
            if (isChecked) {
              updatedSelectedDevices.add(deviceName);
            } else {
              updatedSelectedDevices.delete(deviceName);
            }
            return {
              ...meeting,
              selectedDevices: updatedSelectedDevices,
            };
          }
          return meeting;
        });
      });
    },
    []
  );

  const startRecording = async () => {
    setIsStartingRecording(true);
    try {
      setLiveMeeting({
        isRecording: true,
        startTime: new Date().toISOString(),
        transcription: "",
      });

      // Start streaming transcriptions
      try {
        for await (const chunk of pipe.streamTranscriptions()) {
          console.log("chunk", chunk);
          setLiveMeeting((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              transcription:
                prev.transcription + (chunk.choices[0]?.text || ""),
            };
          });
        }
      } catch (error: any) {
        // Handle specific error cases
        let errorMessage = "failed to start recording. ";

        if (error?.message?.includes("403") || error?.status === 403) {
          errorMessage +=
            "please enable real-time transcription in your backend settings.";
        } else {
          errorMessage += "please check your connection and try again.";
        }

        setLiveMeeting(null);
        toast({
          title: "error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("error starting recording:", error);
      setLiveMeeting(null);
      toast({
        title: "error",
        description:
          "unexpected error occurred while recording. please try again.",
        variant: "destructive",
      });
    } finally {
      setIsStartingRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!liveMeeting) return;

    try {
      // Create a new meeting from the live recording
      const newMeeting: Meeting = {
        meetingGroup: Math.max(...meetings.map((m) => m.meetingGroup), 0) + 1,
        meetingStart: liveMeeting.startTime,
        meetingEnd: new Date().toISOString(),
        fullTranscription: liveMeeting.transcription,
        name: null,
        participants: null,
        summary: null,
        selectedDevices: new Set(["live recording"]),
        deviceNames: new Set(["live recording"]),
        segments: [
          {
            timestamp: liveMeeting.startTime,
            transcription: liveMeeting.transcription,
            deviceName: "live recording",
            deviceType: "input",
            speaker: {
              id: -1,
              name: "live",
            },
          },
        ],
      };

      setMeetings((prev) => [newMeeting, ...prev]);
      await setItem("meetings", [newMeeting, ...meetings]);

      setLiveMeeting(null);
      setIsStartingRecording(false);

      toast({
        title: "recording saved",
        description: "your meeting has been saved successfully.",
      });
    } catch (error) {
      console.error("error saving recording:", error);
      setIsStartingRecording(false);
      toast({
        title: "error",
        description: "failed to save recording. please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <div>loading meetings...</div>;
  }

  return (
    <Card>
      <CardContent
        className="h-full"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <CardHeader className="py-4 px-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">
                meeting and conversation history
              </h2>
              {!liveMeeting ? (
                <Button
                  onClick={startRecording}
                  disabled={isStartingRecording || !isStreamingAvailable}
                  variant="default"
                  size="sm"
                  className="ml-4"
                >
                  {isStartingRecording ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlusCircle className="h-4 w-4 mr-2" />
                  )}
                  new meeting
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <span className="flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                        recording live
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-medium">live transcription</h4>
                        <div className="h-40 overflow-y-auto text-sm bg-gray-50 p-2 rounded">
                          {liveMeeting.transcription}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    onClick={stopRecording}
                    variant="destructive"
                    size="sm"
                  >
                    <X className="h-4 w-4 mr-2" />
                    stop
                  </Button>
                </div>
              )}
            </div>
            <div className="flex space-x-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleClearMeetings}
                      disabled={isClearing}
                      size="sm"
                      variant="outline"
                      className="text-xs"
                    >
                      {isClearing ? (
                        <Trash2 className="h-4 w-4 animate-pulse" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span className="ml-2">reset data</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>
                      this will restore your meeting data to the original state
                      based on transcription timestamps,
                      <br />
                      without the editing you have done here
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      size="sm"
                      variant="outline"
                      className="text-xs"
                    >
                      {isRefreshing ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="ml-2">refresh</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>fetch latest meeting data</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </CardHeader>

        <div className="flex-grow overflow-auto">
          {loading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 border rounded animate-pulse">
                  <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
                  <div className="h-20 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {showError && error && (
                <div
                  className="bg-gray-100 border-l-4 border-black text-gray-700 p-4 mb-4 flex justify-between items-center"
                  role="alert"
                >
                  <div>
                    <p className="font-bold">warning</p>
                    <p>{error}</p>
                  </div>
                  <button
                    onClick={() => setShowError(false)}
                    className="text-gray-700 hover:text-black"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              {meetings.length === 0 && !loading && !error && (
                <p className="text-center">no meetings found.</p>
              )}
              <div className="space-y-6">
                {sortedMeetings.map((meeting, index) => (
                  <React.Fragment key={index}>
                    <Card className="relative">
                      <CardHeader>
                        <div className="grid grid-cols-2">
                          <div>
                            <CardTitle className="text-lg font-semibold flex flex-wrap items-center gap-2">
                              meeting {meeting.meetingGroup}
                              {meeting.mergedWith &&
                                meeting.mergedWith.length > 0 && (
                                  <>
                                    <Badge variant="secondary">merged</Badge>
                                    {meeting.mergedWith.map((mergedGroupId) => (
                                      <Badge
                                        key={mergedGroupId}
                                        variant="outline"
                                      >
                                        meeting {mergedGroupId}
                                      </Badge>
                                    ))}
                                  </>
                                )}
                            </CardTitle>
                            <CardDescription>
                              {formatDate(meeting.meetingStart)} -{" "}
                              {formatDate(meeting.meetingEnd)}
                            </CardDescription>
                          </div>
                          <div className="mb-4 text-end">
                            <h4 className="font-semibold mb-2">Devices:</h4>
                            <div className="flex flex-wrap gap-4 justify-end">
                              {Array.from(meeting.deviceNames).map(
                                (deviceName) => (
                                  <label
                                    key={deviceName}
                                    className="flex items-center space-x-2"
                                  >
                                    <Checkbox
                                      checked={meeting.selectedDevices.has(
                                        deviceName
                                      )}
                                      onCheckedChange={(checked) =>
                                        handleDeviceToggle(
                                          meeting.meetingGroup,
                                          deviceName,
                                          checked as boolean
                                        )
                                      }
                                    />
                                    <span className="text-sm">
                                      {deviceName}
                                    </span>
                                  </label>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4 relative">
                          <h4 className="font-semibold mb-2">transcription:</h4>
                          <div className="flex gap-2 absolute top-0 right-0">
                            <Button
                              onClick={() =>
                                copyWithToast(
                                  meeting.segments
                                    .filter((s) =>
                                      meeting.selectedDevices.has(s.deviceName)
                                    )
                                    .map(
                                      (s) =>
                                        `${formatTimestamp(s.timestamp)} [${
                                          s.speaker
                                            ? s.speaker.name
                                            : s.deviceType?.toLowerCase() ===
                                              "input"
                                            ? "you"
                                            : "others"
                                        }] ${s.transcription}`
                                    )
                                    .join("\n"),
                                  "transcription"
                                )
                              }
                              className="p-1 h-6 w-6"
                              variant="outline"
                              size="icon"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                          <EditorProvider
                            extensions={extensions}
                            content={meeting.segments
                              .filter((s) =>
                                meeting.selectedDevices.has(s.deviceName)
                              )
                              .map(
                                (s) =>
                                  `<p><span class="select-none text-gray-500"><strong>${formatTimestamp(
                                    s.timestamp
                                  )} [${
                                    s.speaker
                                      ? s.speaker.name
                                      : s.deviceType?.toLowerCase() === "input"
                                      ? "you"
                                      : "others"
                                  }]</strong></span> ${s.transcription}</p>`
                              )
                              .join("")}
                            onUpdate={({ editor }) => {
                              console.log("editor update triggered");
                              const content = editor.getHTML();

                              // Parse the HTML content to extract timestamps and transcriptions
                              const parser = new DOMParser();
                              const doc = parser.parseFromString(
                                content,
                                "text/html"
                              );
                              const paragraphs = doc.querySelectorAll("p");

                              // Update segments with new transcriptions while preserving timestamps and speakers
                              const updatedSegments = meeting.segments.map(
                                (segment, index) => {
                                  if (
                                    index < paragraphs.length &&
                                    meeting.selectedDevices.has(
                                      segment.deviceName
                                    )
                                  ) {
                                    const paragraph = paragraphs[index];
                                    // Extract everything after the timestamp and speaker info
                                    const text = paragraph.textContent || "";
                                    const timestampMatch =
                                      text.match(/\[(.*?)\]/);
                                    if (timestampMatch) {
                                      const transcription = text
                                        .substring(text.indexOf("]") + 1)
                                        .trim();
                                      return {
                                        ...segment,
                                        transcription,
                                      };
                                    }
                                  }
                                  return segment;
                                }
                              );

                              console.log("updated segments:", updatedSegments);

                              // Update meetings state with new content
                              const updatedMeetings = meetings.map((m) =>
                                m.meetingGroup === meeting.meetingGroup
                                  ? {
                                      ...m,
                                      segments: updatedSegments,
                                      fullTranscription: updatedSegments
                                        .map(
                                          (s) =>
                                            `${formatTimestamp(s.timestamp)} [${
                                              s.speaker
                                                ? s.speaker.name
                                                : s.deviceType?.toLowerCase() ===
                                                  "input"
                                                ? "you"
                                                : "others"
                                            }] ${s.transcription}`
                                        )
                                        .join("\n"),
                                    }
                                  : m
                              );

                              console.log(
                                "saving updated meetings:",
                                updatedMeetings
                              );

                              // Use Promise to ensure storage completes
                              (async () => {
                                try {
                                  await setItem("meetings", updatedMeetings);
                                  setMeetings(updatedMeetings);
                                  console.log("save completed successfully");
                                } catch (err) {
                                  console.error(
                                    "failed to save meetings:",
                                    err
                                  );
                                }
                              })();
                            }}
                            editorProps={{
                              attributes: {
                                class:
                                  "prose-sm p-3 rounded min-h-[10rem] max-h-[30rem] overflow-y-auto whitespace-pre-wrap break-words border shadow-sm",
                              },
                            }}
                          />
                        </div>
                        <div className="relative">
                          <h4 className="font-semibold mb-2">summary:</h4>
                          {meeting.summary && (
                            <Button
                              onClick={() =>
                                copyWithToast(meeting.summary || "", "summary")
                              }
                              className="absolute top-0 right-0 p-1 h-6 w-6"
                              variant="outline"
                              size="icon"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          {meeting.summary ? (
                            <ReactMarkdown className="prose max-w-none">
                              {meeting.summary}
                            </ReactMarkdown>
                          ) : (
                            <div className="flex items-center mt-2">
                              <Input
                                type="text"
                                value={customSummaryPrompt}
                                onChange={(e) =>
                                  setCustomSummaryPrompt(e.target.value)
                                }
                                placeholder="custom summary prompt (optional)"
                                className="mr-2 p-2 border rounded text-sm flex-grow"
                              />
                              <Button
                                onClick={() => generateSummary(meeting)}
                                disabled={isSummarizing}
                              >
                                {isSummarizing ? (
                                  <FileText className="h-4 w-4 mr-2 animate-pulse" />
                                ) : (
                                  <PlusCircle className="h-4 w-4 mr-2" />
                                )}
                                {isSummarizing
                                  ? "generating summary..."
                                  : "generate summary"}
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </React.Fragment>
                ))}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
