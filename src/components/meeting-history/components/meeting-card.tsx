import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Wand2, FileText, ChevronDown, Trash2 } from "lucide-react"
import { useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { MeetingPrepDetails } from "./meeting-prep-card"
import { Settings } from "@screenpipe/browser"
import { LiveMeetingData } from "@/components/live-transcription/hooks/storage-for-live-meeting"
import { generateMeetingName } from "../ai-meeting-title"
import { generateMeetingSummary } from "../ai-meeting-summary"
import { MeetingAnalysis } from "../../live-transcription/hooks/ai-create-all-notes"

interface MeetingCardProps {
  meeting: LiveMeetingData
  onUpdate: (id: string, update: { 
    aiName?: string; 
    aiSummary?: string;
    analysis?: MeetingAnalysis | null;
    title?: string;
  }) => void
  settings: Settings
  onDelete?: () => void
}

export function MeetingCard({ meeting, onUpdate, settings, onDelete }: MeetingCardProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const { toast } = useToast()

  const formatTime = (dateStr: string): string => {
    return new Date(dateStr).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return '0m'
    const startTime = new Date(start).getTime()
    const endTime = new Date(end).getTime()
    const durationMs = endTime - startTime
    
    const minutes = Math.floor(durationMs / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`
    }
    return `${minutes}m`
  }

  const handleGenerateName = async () => {
    if (isGenerating) return
    
    setIsGenerating(true)
    try {
      if (!settings) {
        throw new Error("no settings found")
      }
      
      console.log("generating name for meeting:", {
        id: meeting.id,
        currentTitle: meeting.title
      })
      
      const newTitle = await generateMeetingName(meeting, settings)
      
      onUpdate(meeting.id, { 
        title: newTitle,
        aiName: newTitle, // Adding this for backwards compatibility
        analysis: meeting.analysis // Preserve existing analysis
      })
      
      toast({
        title: "name generated",
        description: "ai name has been generated and saved",
      })
    } catch (error) {
      console.error("failed to generate name:", error)
      toast({
        title: "generation failed",
        description: "failed to generate ai name. please try again",
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateSummary = async () => {
    if (isGeneratingSummary) return
    
    setIsGeneratingSummary(true)
    try {
      if (!settings) {
        throw new Error("no settings found")
      }
      
      console.log("generating summary for meeting:", {
        id: meeting.id,
        title: meeting.title
      })
      
      const aiSummary = await generateMeetingSummary(meeting, settings)
      
      // Update only the analysis field while preserving other fields
      onUpdate(meeting.id, { 
        analysis: {
          facts: meeting.analysis?.facts || [],
          events: meeting.analysis?.events || [],
          flow: meeting.analysis?.flow || [],
          decisions: meeting.analysis?.decisions || [],
          summary: [aiSummary]
        }
      })
      
      toast({
        title: "summary generated",
        description: "ai summary has been generated and saved",
      })
    } catch (error) {
      console.error("failed to generate summary:", error)
      toast({
        title: "generation failed", 
        description: "failed to generate ai summary. please try again",
        variant: "destructive",
      })
    } finally {
      setIsGeneratingSummary(false)
    }
  }

  const getDurationMinutes = (start: string, end?: string): number => {
    if (!end) return 0
    const startTime = new Date(start).getTime()
    const endTime = new Date(end).getTime()
    return Math.floor((endTime - startTime) / (1000 * 60))
  }

  const durationMinutes = getDurationMinutes(meeting.startTime, meeting.endTime)

  return (
    <Card className="w-full mb-1 border-0 -mx-2">
      <CardContent className="p-3 relative">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-muted-foreground/10 origin-bottom transition-transform duration-500"
          style={{ 
            transform: `scaleY(${0.5 + Math.min(durationMinutes / 60, 1) * 0.5})`,
            opacity: 0.2
          }} 
        />
        <div className="flex gap-4">
          <div className="flex-none w-[30%]">
            <h3 className="text-base font-bold">
              {meeting.title || "untitled meeting"}
            </h3>
            <div className="text-sm text-muted-foreground flex items-center justify-between">
              <div className="flex items-center">
                {formatTime(meeting.startTime)} • {formatDuration(meeting.startTime, meeting.endTime)}
                <div 
                  className="h-3 w-2 bg-muted-foreground/20 origin-left transition-transform duration-500 ml-2"
                  style={{ transform: `scaleX(${0.5 + Math.min(durationMinutes / 60, 1) * 5.0})` }}
                />
              </div>
              <div className="flex">
                <HoverCard openDelay={0} closeDelay={0}>
                  <HoverCardTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1"
                      onClick={handleGenerateName}
                      disabled={isGenerating}
                    >
                      <Wand2 className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`} />
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-auto p-2">
                    <span className="text-sm text-muted-foreground">
                      re-generate an ai name for this meeting
                    </span>
                  </HoverCardContent>
                </HoverCard>
                <HoverCard openDelay={0} closeDelay={0}>
                  <HoverCardTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1"
                      onClick={handleGenerateSummary}
                      disabled={isGeneratingSummary}
                    >
                      <FileText className={`h-4 w-4 ${isGeneratingSummary ? "animate-spin" : ""}`} />
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-auto p-2">
                    <span className="text-sm text-muted-foreground">
                      generate an ai summary for this meeting
                    </span>
                  </HoverCardContent>
                </HoverCard>
                {meeting.analysis && !meeting.endTime && (
                  <HoverCard openDelay={0} closeDelay={0}>
                    <HoverCardTrigger asChild>
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1 flex items-center gap-1 text-purple-500 dark:text-purple-400 hover:text-purple-600 dark:hover:text-purple-300"
                          >
                            <span className="text-xs">ai prep</span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="absolute left-0 right-0 mt-2 z-20 bg-white dark:bg-gray-950 border rounded-md p-4 shadow-lg">
                          <MeetingPrepDetails aiPrep={meeting.analysis} />
                        </CollapsibleContent>
                      </Collapsible>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-auto p-2">
                      <span className="text-sm text-muted-foreground">
                        view ai-generated meeting preparation insights
                      </span>
                    </HoverCardContent>
                  </HoverCard>
                )}
                <HoverCard openDelay={0} closeDelay={0}>
                  <HoverCardTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1 text-destructive"
                      onClick={onDelete}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-auto p-2">
                    <span className="text-sm text-muted-foreground">
                      delete this meeting
                    </span>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </div>
          </div>
          <div className="flex-1">
            {meeting.analysis?.summary && (
              <div className="text-sm text-muted-foreground">
                {meeting.analysis.summary}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}