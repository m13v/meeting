import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react'
import { TranscriptionChunk, Note, MeetingSegment } from "../../meeting-history/types"
import { MeetingAnalysis } from "./ai-create-all-notes"
import localforage from "localforage"

// Storage setup
export const liveStore = localforage.createInstance({
    name: "live-meetings",
    storeName: "transcriptions"
})

// Add new LocalForage instance for archived meetings
export const archivedLiveStore = localforage.createInstance({
    name: "live-meetings",
    storeName: "archived"  // Different storeName to separate from current live meeting
})

// Export the key
export const LIVE_MEETING_KEY = 'current-live-meeting'

export interface LiveMeetingData {
    id: string  // Add explicit ID field
    chunks: TranscriptionChunk[]  // Keep raw chunks
    mergedChunks: TranscriptionChunk[]  // Add merged chunks
    editedMergedChunks: Record<number, string>  // Rename to be explicit
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
}

// Context creation
const MeetingContext = createContext<MeetingContextType | undefined>(undefined)

export function MeetingProvider({ children }: { children: ReactNode }) {
    const [data, setData] = useState<LiveMeetingData | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        console.log('meeting provider mounted')
        const loadData = async () => {
            try {
                console.log('MeetingProvider: loading data')
                
                const stored = await liveStore.getItem<LiveMeetingData>(LIVE_MEETING_KEY)
                console.log('MeetingProvider: loaded data:', {
                    exists: !!stored,
                    chunks: stored?.chunks?.length,
                    title: stored?.title,
                    notes: stored?.notes?.length,
                    notesData: stored?.notes?.map(n => ({
                        id: n.id,
                        text: n.text?.slice(0, 50),
                        timestamp: n.timestamp
                    }))
                })
                
                if (!stored) {
                    console.log('MeetingProvider: no stored data, initializing new')
                }
                
                console.log('loading stored data:', {
                    editedMergedChunksCount: Object.keys(stored?.editedMergedChunks || {}).length,
                    editedMergedChunks: stored?.editedMergedChunks
                })
                
                setData(stored || {
                    id: `live-meeting-${new Date().toISOString()}`,
                    chunks: [],
                    mergedChunks: [],
                    editedMergedChunks: {},
                    speakerMappings: {},
                    lastProcessedIndex: -1,
                    startTime: new Date().toISOString(),
                    title: null,
                    notes: [],
                    analysis: null,
                    deviceNames: new Set(),
                    selectedDevices: new Set(),
                    isArchived: false  // Explicitly set as non-archived for new meetings
                })
            } catch (error) {
                console.error('MeetingProvider: failed to load meeting data:', error)
            } finally {
                setIsLoading(false)
            }
        }
        loadData()
        return () => console.log('meeting provider unmounted')
    }, [])

    const updateStore = async (newData: LiveMeetingData) => {
        try {
            // Get existing data to preserve isArchived if not explicitly set
            const existing = await liveStore.getItem<LiveMeetingData>(LIVE_MEETING_KEY)
            
            const dataToStore = {
                ...newData,
                // Keep existing isArchived unless explicitly set in newData
                isArchived: newData.isArchived !== undefined ? newData.isArchived : existing?.isArchived
            }
            
            console.log('updateStore: saving meeting:', {
                id: dataToStore.id,
                isArchived: dataToStore.isArchived,
                title: dataToStore.title,
                chunks: dataToStore.chunks?.length,
                preservedFromExisting: existing?.isArchived
            })
            
            await liveStore.setItem(LIVE_MEETING_KEY, dataToStore)
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
        console.log('setting notes:', {
            count: notes.length,
            notes: notes.map(n => ({
                text: n.text?.slice(0, 50),
                timestamp: n.timestamp,
                id: n.id
            })),
            stack: new Error().stack?.split('\n').slice(1,3)
        })
        await updateStore({ ...data, notes })
    }

    const setAnalysis = async (analysis: MeetingAnalysis | null) => {
        if (!data) return
        console.log('setting analysis:', analysis)
        await updateStore({ ...data, analysis })
    }

    const value = useMemo(() => ({
        title: data?.title || '',
        setTitle,
        notes: data?.notes || [],
        setNotes,
        segments: (data?.chunks || []).map(chunk => ({
            timestamp: chunk.timestamp,
            transcription: data?.editedMergedChunks[chunk.id] || chunk.text,
            deviceName: chunk.deviceName || '',
            speaker: data?.speakerMappings[chunk.speaker || 'speaker_0'] || chunk.speaker || 'speaker_0'
        })),
        setSegments: async () => {},
        analysis: data?.analysis || null,
        setAnalysis,
        isLoading,
        data,
        updateStore
    }), [data, isLoading])

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
    liveStore.removeItem(LIVE_MEETING_KEY)
    console.log('cleared live meeting data')
}

export async function storeLiveChunks(chunks: TranscriptionChunk[] = [], mergedChunks: TranscriptionChunk[] = []): Promise<void> {
    try {
        const existing = await liveStore.getItem<LiveMeetingData>(LIVE_MEETING_KEY)
        const data: LiveMeetingData = {
            id: `live-meeting-${new Date().toISOString()}`,
            chunks,
            mergedChunks,
            editedMergedChunks: existing?.editedMergedChunks ?? {},
            speakerMappings: existing?.speakerMappings ?? {},
            lastProcessedIndex: existing?.lastProcessedIndex ?? -1,
            startTime: existing?.startTime ?? new Date().toISOString(),
            title: existing?.title ?? null,
            notes: existing?.notes ?? [],
            analysis: existing?.analysis ?? null,
            deviceNames: existing?.deviceNames ?? new Set(),
            selectedDevices: existing?.selectedDevices ?? new Set(),
            isArchived: existing?.isArchived // Preserve isArchived flag
        }
        console.log('storing live meeting data:', {
            rawChunks: chunks.length,
            mergedChunks: mergedChunks.length,
            isArchived: data.isArchived
        })
        await liveStore.setItem(LIVE_MEETING_KEY, data)
    } catch (error) {
        console.error('failed to store live meeting:', error)
    }
}

export async function getLiveMeetingData(): Promise<LiveMeetingData | null> {
    try {
        console.log('getLiveMeetingData: loading')
        
        const data = await liveStore.getItem<LiveMeetingData>(LIVE_MEETING_KEY)
        
        console.log('getLiveMeetingData: raw data:', {
            exists: !!data,
            id: data?.id,
            isArchived: data?.isArchived,
            title: data?.title
        })
        
        if (!data) return null
        
        // Ensure dates are properly restored
        if (data.notes) {
            data.notes = data.notes.map(note => ({
                ...note,
                timestamp: new Date(note.timestamp),
                editedAt: note.editedAt ? new Date(note.editedAt) : undefined
            }))
        }
        
        return data
    } catch (error) {
        console.error('getLiveMeetingData: failed:', error)
        return null
    }
}

export async function clearLiveMeetingData(): Promise<void> {
    try {
        const currentData = await liveStore.getItem<LiveMeetingData>(LIVE_MEETING_KEY)
        
        // Don't clear if it's an archived meeting being viewed
        // if (currentData?.isArchived) {
        //     console.log('skipping clear for archived meeting:', {
        //         id: currentData.id,
        //         title: currentData.title
        //     })
        //     return
        // }
        
        console.log('clearing live meeting data:', {
            had_title: !!currentData?.title,
            notes_count: currentData?.notes.length,
            chunks_count: currentData?.chunks.length,
            analysis: !!currentData?.analysis,
            start_time: currentData?.startTime,
        })
        
        // Create empty state with new timestamp for id
        const startTime = new Date().toISOString()
        const emptyState: LiveMeetingData = {
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
            deviceNames: new Set(),
            selectedDevices: new Set(),
            isArchived: false  // Explicitly set as non-archived for new empty state
        }
        
        await liveStore.setItem(LIVE_MEETING_KEY, emptyState)
        await liveStore.removeItem(LIVE_MEETING_KEY)
        console.log('live meeting data cleared successfully')
    } catch (error) {
        console.error('failed to clear live meeting data:', error)
        throw error
    }
}

// Add function to archive current live meeting
export async function archiveLiveMeeting(): Promise<boolean> {
    try {
        const meeting = await liveStore.getItem<LiveMeetingData>(LIVE_MEETING_KEY)
        if (!meeting) {
            throw new Error('no meeting data found to archive')
        }

        // Don't archive if it's already an archived meeting being viewed
        if (meeting.isArchived) {
            console.log('skipping archive for already archived meeting:', {
                id: meeting.id,
                title: meeting.title
            })
            return true
        }

        // Ensure we have required fields
        if (!meeting.startTime) {
            meeting.startTime = new Date().toISOString()
        }
        
        const id = `live-meeting-${meeting.startTime}`
        
        console.log('archiving meeting:', { 
            id, 
            startTime: meeting.startTime,
            title: meeting.title,
            chunks: meeting.chunks?.length,
            notes: meeting.notes?.length
        })
        
        await archivedLiveStore.setItem(id, {
            ...meeting,
            id,
            endTime: meeting.endTime || new Date().toISOString()
        })
        
        await clearLiveMeetingData()
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
        let needsSaving = false
        
        await archivedLiveStore.iterate<LiveMeetingData, void>((value, key) => {
            // Ensure each meeting has required fields
            if (!value.id || !value.isArchived) {
                needsSaving = true
                console.log('fixing archived meeting metadata:', {
                    id: value.id || `live-meeting-${value.startTime}`,
                    title: value.title,
                    startTime: value.startTime
                })
                value.id = value.id || `live-meeting-${value.startTime}`
                value.isArchived = true
                // Save back to storage
                archivedLiveStore.setItem(key, value)
            }
            archived.push(value)
        })

        // Sort by start time, newest first
        archived.sort((a, b) => 
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        )

        console.log('loaded archived meetings:', {
            count: archived.length,
            latest: archived[0]?.title,
            allHaveIds: archived.every(m => !!m.id),
            allAreArchived: archived.every(m => m.isArchived),
            neededIdUpdate: needsSaving
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
    await archivedLiveStore.iterate<LiveMeetingData, void>((value, key) => {
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
      await archivedLiveStore.removeItem(keyToDelete)
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
        const meeting = await archivedLiveStore.getItem<LiveMeetingData>(id)
        if (!meeting) {
            console.error('meeting not found for update:', { id })
            return null
        }
        
        // Create updated meeting data - preserve existing fields
        const updated = { 
            ...meeting,  // First spread existing meeting
            ...update,   // Then apply updates
            title: update.title ?? meeting.title  // Explicitly preserve title if not in update
        }
        
        console.log('updating archived meeting:', { 
            id,
            oldTitle: meeting.title,
            newTitle: updated.title,
            fullUpdate: update
        })
        
        await archivedLiveStore.setItem(id, updated)
        return updated
    } catch (error) {
        console.error('failed to update archived meeting:', error)
        return null
    }
} 