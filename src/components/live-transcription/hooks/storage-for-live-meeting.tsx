import { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback, useRef } from 'react'
import { TranscriptionChunk, Note, MeetingSegment } from "../../meeting-history/types"
import { MeetingAnalysis } from "./ai-create-all-notes"
import localforage from "localforage"
import { useSettings } from "@/lib/hooks/use-settings"
import { createHandleNewChunk } from './handle-new-chunk'
import { ImprovedChunk } from './handle-new-chunk'

// Remove liveStore, keep only one store
export const meetingStore = localforage.createInstance({
    name: "live-meetings",
    storeName: "meetings"  // All meetings live here
})

export interface LiveMeetingData {
    id: string  // Add explicit ID field
    chunks: TranscriptionChunk[]  // Keep raw chunks
    mergedChunks: TranscriptionChunk[]  // Add merged chunks
    editedMergedChunks: Record<number, ImprovedChunk>  // Change type to include diffs
    speakerMappings: Record<string, string>
    lastProcessedIndex: number
    startTime: string
    endTime?: string
    title: string | null
    notes: Note[]
    analysis: MeetingAnalysis | null
    deviceNames: Set<string>
    selectedDevices: Set<string>
    // New fields
    agenda?: string
    participants_invited?: string[]
    recurrence?: string
    participants?: string[] | null
    guestCount?: number
    confirmedCount?: number
    organizer?: string
    aiPrep?: {
        previousContext: {
            lastInteraction: string
            personContext: Record<string, {
                personality: string
                communicationStyle: string
                pastDecisions: string[]
                strengths: string[]
                challenges: string[]
            }>
            agreedNextSteps: string[]
        }
        suggestedPrep: {
            reviewPoints: string[]
            discussionTopics: string[]
            meetingTips: string[]
        }
    }
    isArchived?: boolean // Add optional flag
}

// Context type
interface MeetingContextType {
    title: string
    setTitle: (title: string) => Promise<void>
    notes: Note[]
    setNotes: (notes: Note[]) => Promise<void>
    segments: MeetingSegment[]
    setSegments: (segments: MeetingSegment[]) => Promise<void>
    analysis: MeetingAnalysis | null
    setAnalysis: (analysis: MeetingAnalysis | null) => Promise<void>
    isLoading: boolean
    data: LiveMeetingData | null
    updateStore: (newData: LiveMeetingData) => Promise<boolean>
    reloadData: () => Promise<void>
    onNewChunk: (chunk: TranscriptionChunk) => Promise<void>
    improvingChunks: Record<number, boolean>
    setImprovingChunks: (chunks: Record<number, boolean>) => void
    recentlyImproved: Record<number, boolean>
    setRecentlyImproved: (chunks: Record<number, boolean>) => void
}

// Context creation
const MeetingContext = createContext<MeetingContextType | undefined>(undefined)

export function MeetingProvider({ children }: { children: ReactNode }) {
    const [data, setData] = useState<LiveMeetingData | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const latestChunksRef = useRef<TranscriptionChunk[]>([])
    const { settings } = useSettings()
    const [improvingChunks, setImprovingChunks] = useState<Record<number, boolean>>({})
    const [recentlyImproved, setRecentlyImproved] = useState<Record<number, boolean>>({})

    // Single source of truth for loading data
    const loadData = async () => {
        try {
            let activeMeeting: LiveMeetingData | null = null
            await meetingStore.iterate<LiveMeetingData, void>((value) => {
                if (!value.isArchived) {
                    activeMeeting = value
                    return
                }
            })

            console.log('MeetingProvider: loaded data:', {
                exists: !!activeMeeting,
                id: activeMeeting?.id,
                chunks: activeMeeting?.chunks?.length,
                title: activeMeeting?.title,
            })
            
            if (!activeMeeting) {
                const startTime = new Date().toISOString()
                const newData: LiveMeetingData = {
                    id: `live-meeting-${startTime}`,
                    chunks: [],
                    mergedChunks: [],
                    editedMergedChunks: {},
                    speakerMappings: {},
                    lastProcessedIndex: -1,
                    startTime,
                    title: null,
                    notes: [],
                    analysis: null,
                    deviceNames: new Set<string>(),
                    selectedDevices: new Set<string>(),
                    isArchived: false
                }
                await meetingStore.setItem(newData.id, newData)
                setData(newData)
            } else {
                setData(activeMeeting)
            }
            
            return activeMeeting
        } catch (error) {
            console.error('MeetingProvider: failed to load:', error)
            return null
        } finally {
            setIsLoading(false)
        }
    }

    // Expose reload function through context
    const reloadData = async () => {
        setIsLoading(true)
        await loadData()
    }

    useEffect(() => {
        console.log('meeting provider mounted')
        loadData()
        return () => console.log('meeting provider unmounted')
    }, [])

    const updateStore = async (newData: LiveMeetingData) => {
        try {            
            await meetingStore.setItem(newData.id, newData)
            setData(newData)
            latestChunksRef.current = newData.chunks
            return true
        } catch (error) {
            console.error('updateStore: failed:', error)
            return false
        }
    }

    const setTitle = async (title: string) => {
        if (!data) {
            console.log('setTitle: no data available')
            return
        }
        console.log('setTitle: starting update', {
            oldTitle: data.title,
            newTitle: title,
            dataState: !!data
        })
        await updateStore({ ...data, title })
        console.log('setTitle: completed update')
    }

    const setNotes = async (notes: Note[]) => {
        if (!data) return
        // console.log('setting notes:', {
        //     count: notes.length,
        //     notes: notes.map(n => ({
        //         text: n.text?.slice(0, 50),
        //         timestamp: n.timestamp,
        //         id: n.id
        //     })),
        //     currentTitle: data.title,
        //     stack: new Error().stack?.split('\n').slice(1,3)
        // })
        await updateStore({ 
            ...data,
            notes,
            title: data.title,
            startTime: data.startTime,
            id: data.id
        })
    }

    const setAnalysis = async (analysis: MeetingAnalysis | null) => {
        if (!data) return
        console.log('setting analysis:', analysis)
        await updateStore({ ...data, analysis })
    }

    const handleNewChunk = useCallback(
        createHandleNewChunk({
            setData,
            setImprovingChunks,
            setRecentlyImproved,
            updateStore,
            settings
        }),
        [settings]
    )

    // Initialize ref when data loads
    useEffect(() => {
        if (data) {
            latestChunksRef.current = data.chunks
        }
    }, [data])

    const value = useMemo(() => ({
        title: data?.title || '',
        setTitle,
        notes: data?.notes || [],
        setNotes,
        segments: (data?.chunks || []).map(chunk => ({
            timestamp: chunk.timestamp,
            transcription: data?.editedMergedChunks[chunk.id]?.text || chunk.text,
            deviceName: chunk.deviceName || '',
            speaker: data?.speakerMappings[chunk.speaker || 'speaker_0'] || chunk.speaker || 'speaker_0'
        })),
        setSegments: async () => {},
        analysis: data?.analysis || null,
        setAnalysis,
        isLoading,
        data,
        updateStore,
        reloadData,
        setSegments: async () => {},
        onNewChunk: handleNewChunk,
        improvingChunks,
        setImprovingChunks,
        recentlyImproved,
        setRecentlyImproved,
    }), [data, isLoading, handleNewChunk, improvingChunks, recentlyImproved])

    return (
        <MeetingContext.Provider value={value}>
            {children}
        </MeetingContext.Provider>
    )
}

export function useMeetingContext() {
    const context = useContext(MeetingContext)
    if (!context) {
        throw new Error('useMeetingContext must be used within a MeetingProvider')
    }
    return context
}

// Storage operations
export const getCurrentKey = () => LIVE_MEETING_KEY

export const clearCurrentKey = () => {
    meetingStore.removeItem(LIVE_MEETING_KEY)
    console.log('cleared live meeting data')
}


export async function clearLiveMeetingData(): Promise<void> {
    try {
        const currentData = await meetingStore.getItem<LiveMeetingData>(LIVE_MEETING_KEY)
        
        console.log('clearing live meeting data:', {
            had_title: !!currentData?.title,
            notes_count: currentData?.notes.length,
            chunks_count: currentData?.chunks.length,
            analysis: !!currentData?.analysis,
            start_time: currentData?.startTime,
        })
        
        await meetingStore.removeItem(LIVE_MEETING_KEY)
        console.log('live meeting data cleared successfully')
    } catch (error) {
        console.error('failed to clear live meeting data:', error)
        throw error
    }
}

// Add function to archive current live meeting
export async function archiveLiveMeeting(): Promise<boolean> {
    try {
        // Find active meeting
        let activeMeeting: LiveMeetingData | null = null
        await meetingStore.iterate<LiveMeetingData, void>((value) => {
            if (!value.isArchived) {
                activeMeeting = value
                return
            }
        })

        if (!activeMeeting) {
            throw new Error('no meeting data found to archive')
        }

        // Don't archive if it's already an archived meeting being viewed
        if (activeMeeting.isArchived) {
            console.log('skipping archive for already archived meeting:', {
                id: activeMeeting.id,
                title: activeMeeting.title
            })
            return true
        }

        // Ensure we have required fields
        if (!activeMeeting.startTime) {
            activeMeeting.startTime = new Date().toISOString()
        }
        
        console.log('archiving meeting:', { 
            id: activeMeeting.id,
            startTime: activeMeeting.startTime,
            title: activeMeeting.title,
            chunks: activeMeeting.chunks?.length,
            notes: activeMeeting.notes?.length
        })
        
        await meetingStore.setItem(activeMeeting.id, {
            ...activeMeeting,
            isArchived: true,
            endTime: activeMeeting.endTime || new Date().toISOString()
        })
        
        return true
    } catch (error) {
        console.error('failed to archive meeting:', error)
        return false
    }
}

// Add function to get all archived meetings
export async function getArchivedLiveMeetings(): Promise<LiveMeetingData[]> {
    try {
        const archived: LiveMeetingData[] = []
        
        await meetingStore.iterate<LiveMeetingData, void>((value) => {
            if (value.isArchived) {
                archived.push(value)
            }
        })

        // Sort by start time, newest first
        archived.sort((a, b) => 
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        )

        console.log('loaded archived meetings:', {
            count: archived.length,
            latest: archived[0]?.title
        })

        return archived
    } catch (error) {
        console.error('failed to get archived meetings:', error)
        return []
    }
}

// Add function to delete an archived meeting by its start time
export async function deleteArchivedMeeting(startTime: string): Promise<void> {
  try {
    let keyToDelete: string | null = null
    
    // Find the meeting with matching start time
    await meetingStore.iterate<LiveMeetingData, void>((value, key) => {
      if (value.startTime === startTime) {
        keyToDelete = key
        return
      }
    })

    if (keyToDelete) {
      console.log('deleting archived meeting:', {
        key: keyToDelete,
        startTime
      })
      await meetingStore.removeItem(keyToDelete)
    } else {
      console.log('meeting not found for deletion:', startTime)
    }
  } catch (error) {
    console.error('failed to delete archived meeting:', error)
    throw error
  }
}

// Add function to update an archived meeting
export async function updateArchivedMeeting(id: string, update: Partial<LiveMeetingData>) {
    try {
        const meeting = await meetingStore.getItem<LiveMeetingData>(id)
        if (!meeting) {
            console.error('meeting not found for update:', { id })
            return null
        }
        
        // Create updated meeting data - preserve existing fields
        const updated = { 
            ...meeting,  // First spread existing meeting
            ...update,   // Then apply updates
            // Explicitly preserve critical fields unless intentionally updated
            title: update.title ?? meeting.title,
            startTime: update.startTime ?? meeting.startTime,
            id: meeting.id, // Never allow id to be changed
            isArchived: true // Always keep archived status
        }
        
        console.log('updating archived meeting:', { 
            id,
            oldTitle: meeting.title,
            newTitle: updated.title,
            preservedFields: {
                notes: updated.notes?.length,
                chunks: updated.chunks?.length,
                startTime: updated.startTime
            },
            fullUpdate: update
        })
        
        await meetingStore.setItem(id, updated)
        return updated
    } catch (error) {
        console.error('failed to update archived meeting:', error)
        return null
    }
} 