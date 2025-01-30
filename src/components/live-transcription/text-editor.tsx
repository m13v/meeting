'use client'

import { Note } from './types'
import { RefObject, UIEvent } from 'react'

interface TextEditorProps {
  notes: Note[]
  setNotes: (notes: Note[]) => void
  scrollRef?: RefObject<HTMLDivElement>
  onScroll?: (e: UIEvent<HTMLDivElement>) => void
  isEditing?: boolean
}

export function TextEditor({ notes, setNotes, scrollRef, onScroll, isEditing = false }: TextEditorProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle bold text (Ctrl/Cmd + B)
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      const textarea = e.currentTarget
      const { selectionStart, selectionEnd } = textarea
      const text = textarea.value

      // If there's selected text, wrap it with bold syntax
      if (selectionStart !== selectionEnd) {
        const newText = 
          text.slice(0, selectionStart) + 
          '**' + text.slice(selectionStart, selectionEnd) + '**' + 
          text.slice(selectionEnd)

        const newNotes = newText.split('\n').map(text => ({
          id: crypto.randomUUID(),
          text,
          timestamp: new Date(),
          isInput: true,
          device: 'keyboard'
        }))
        setNotes(newNotes)

        // Maintain selection including the markdown syntax
        setTimeout(() => {
          textarea.selectionStart = selectionStart + 2
          textarea.selectionEnd = selectionEnd + 2
        }, 0)
        return
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const textarea = e.currentTarget
      const { selectionStart } = textarea
      const text = textarea.value
      
      // Get the current line
      const lastNewLine = text.lastIndexOf('\n', selectionStart - 1)
      const currentLine = text.slice(lastNewLine + 1, selectionStart)
      
      // Check if current line starts with "• " or "- "
      const isList = currentLine.trimStart().startsWith('• ') || currentLine.trimStart().startsWith('- ')
      
      // If current line is empty and has bullet, remove the bullet
      if (currentLine.trim() === '•' || currentLine.trim() === '-') {
        const newText = text.slice(0, lastNewLine + 1) + text.slice(selectionStart)
        const newNotes = newText.split('\n').map(text => ({
          id: crypto.randomUUID(),
          text,
          timestamp: new Date(),
          isInput: true,
          device: 'keyboard'
        }))
        setNotes(newNotes)
        return
      }

      // Add new line with bullet if current line has bullet
      const insertion = isList ? '\n• ' : '\n'
      const newText = text.slice(0, selectionStart) + insertion + text.slice(selectionStart)
      const newNotes = newText.split('\n').map(text => ({
        id: crypto.randomUUID(),
        text: text.startsWith('- ') ? '• ' + text.slice(2) : text,
        timestamp: new Date(),
        isInput: true,
        device: 'keyboard'
      }))
      setNotes(newNotes)
      
      // Move cursor after the bullet
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + insertion.length
      }, 0)
    }
  }

  return (
    <div 
      ref={scrollRef}
      onScroll={onScroll}
      className="flex flex-col h-full"
    >
      <textarea
        value={notes.map(note => note.text.startsWith('- ') ? '• ' + note.text.slice(2) : note.text).join('\n')}
        onChange={(e) => {
          const newNotes = e.target.value.split('\n').map(text => ({
            id: crypto.randomUUID(),
            text: text.startsWith('• ') ? '- ' + text.slice(2) : text,
            timestamp: new Date(),
            isInput: true,
            device: 'keyboard'
          }))
          setNotes(newNotes)
        }}
        onKeyDown={handleKeyDown}
        className="flex-1 w-full p-3 resize-none focus:outline-none bg-transparent overflow-y-auto"
        placeholder="type your notes..."
        autoFocus={isEditing}
      />
    </div>
  )
} 