'use client'

import { useEffect, useRef, useState } from 'react'

type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: { transcript: string }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: { length: number; [index: number]: SpeechRecognitionResultLike }
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function joinParts(...parts: string[]): string {
  return parts.filter(Boolean).join(' ')
}

export function useSpeechDictation(value: string, setValue: (value: string) => void) {
  const valueRef = useRef(value)
  const setValueRef = useRef(setValue)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')
  const finalResultsRef = useRef(new Map<number, string>())
  const sessionRef = useRef(0)
  const [supported, setSupported] = useState(false)
  const [dictating, setDictating] = useState(false)

  useEffect(() => {
    valueRef.current = value
    setValueRef.current = setValue
  }, [value, setValue])

  useEffect(() => {
    const Recognition = getSpeechRecognition()
    if (!Recognition) return

    const recognition = new Recognition()
    // continuous keeps listening across pauses instead of stopping after one
    // phrase; interimResults is what makes words appear live as they're
    // recognized, before the phrase finalizes. Both required for streaming.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    function committedText(): string {
      return [...finalResultsRef.current.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, transcript]) => transcript)
        .join(' ')
    }

    function renderTranscript(currentInterimText: string): void {
      setValueRef.current(joinParts(baseTextRef.current, committedText(), currentInterimText))
    }

    function finishSession(): void {
      renderTranscript('')
      setDictating(false)
    }

    recognition.onresult = (event) => {
      if (sessionRef.current === 0) return

      // Accumulate finalized segments only, keyed by result index. This is what
      // keeps the staircase gone: each index is written at most once with its
      // own final transcript, never grown by concatenating repeated interim
      // fragments onto committed text.
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) {
          finalResultsRef.current.set(index, (result[0]?.transcript ?? '').trim())
        }
      }

      // Interim text is rebuilt from this event's full results snapshot every
      // time — nothing interim is ever written to a ref/state, so a segment
      // that just finalized has no leftover tail on this or any later render.
      // Scanning the whole array (not just from resultIndex) is what keeps
      // words streaming live: every onresult event re-derives whatever is
      // still in progress right now, however many results are pending.
      const currentInterim: string[] = []
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (!result.isFinal) {
          currentInterim.push((result[0]?.transcript ?? '').trim())
        }
      }
      const interimText = joinParts(...currentInterim)

      renderTranscript(interimText)
    }
    recognition.onerror = finishSession
    recognition.onend = finishSession
    recognitionRef.current = recognition

    queueMicrotask(() => setSupported(true))

    return () => {
      sessionRef.current = 0
      recognition.stop()
      recognitionRef.current = null
    }
  }, [])

  function toggle(): void {
    const recognition = recognitionRef.current
    if (!recognition) return

    if (dictating) {
      sessionRef.current = 0
      recognition.stop()
      setDictating(false)
      return
    }

    baseTextRef.current = valueRef.current.trim()
    finalResultsRef.current.clear()
    sessionRef.current += 1

    try {
      recognition.start()
      setDictating(true)
    } catch {
      sessionRef.current = 0
      setDictating(false)
    }
  }

  return { supported, dictating, toggle }
}
