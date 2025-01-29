import { useState } from 'react'
import { pipe } from "@screenpipe/browser"
import { TranscriptionChunk } from '../types'

export function useRecentChunks() {
  const [chunks, setChunks] = useState<TranscriptionChunk[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchRecentChunks = async () => {
    try {
      console.log('fetching recent chunks')
      const results = await pipe.queryScreenpipe({
        contentType: "audio",
        limit: 10,
        offset: 0,
      })
      
      console.log('recent chunks:', results)
      
      if (!results) {
        console.log('no results returned from queryScreenpipe')
        setChunks([])
        return
      }

      const recentChunks: TranscriptionChunk[] = results.data
        .filter((item: any) => item.type === 'Audio' && item.content)
        .map((item: any) => {
          const content = item.content
          console.log('processing chunk content:', content)
          return {
            timestamp: content.timestamp || new Date().toISOString(),
            text: content.transcription || '',
            isInput: content.deviceType?.toLowerCase() === 'input',
            device: content.deviceName || 'unknown',
            speaker: content.speaker?.id,
            error: content.error
          }
        })
        .reverse()

      console.log('processed chunks:', recentChunks)
      setChunks(recentChunks)
    } catch (error) {
      console.error("failed to fetch recent chunks:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return { chunks, setChunks, isLoading, fetchRecentChunks }
} 