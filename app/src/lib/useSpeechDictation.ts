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

// Owner-reported, 2026-09-28: dictated text was landing glued directly onto
// the end of whatever Description already held, no separating space —
// "the first word adjacent to the last word." Every part passed in here is
// already individually trimmed before this runs (baseTextRef.current at
// assignment, each committed/interim transcript at capture), so a plain
// `.filter(Boolean).join(' ')` should already separate them — but that
// relies on every future caller keeping its own part pre-trimmed, which is
// exactly the kind of implicit contract that's easy to violate without
// noticing. Trimming again here, right at the join, makes a leading or
// trailing space on any one part harmless instead of load-bearing, and is
// the one change that directly guarantees what was reported: never zero
// spaces between two non-empty parts, and never a stray double space either.
function joinParts(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
}

export function useSpeechDictation(value: string, setValue: (value: string) => void) {
  const valueRef = useRef(value)
  const setValueRef = useRef(setValue)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')
  // committedTextRef (2026-09-28, replaces the old per-index
  // Map<number,string> — see mergeFinal below) is the single running
  // "everything finalized so far this session" string. finalizedIndexesRef
  // just remembers which result indices have already been folded in, so a
  // later event re-reporting the same already-final index (the browser is
  // allowed to keep echoing old entries in event.results) is a no-op
  // instead of being merged again.
  const committedTextRef = useRef('')
  const finalizedIndexesRef = useRef(new Set<number>())
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

    // mergeFinal folds a newly-finalized transcript into committedTextRef.
    // Owner-reported, 2026-09-28: dictated text was coming out as a
    // "staircase" — each new bit of speech re-appending everything already
    // said, e.g. "Hello" -> "Hello Hello world" -> "Hello Hello world Hello
    // world today". The previous version (per-index Map, blind join)
    // assumed every browser reports each result index as its own
    // self-contained incremental phrase; some report each new final result
    // as the *whole growing transcript so far*, which the blind join then
    // appends on top of everything already committed instead of replacing
    // it. Checking for overlap first, in both directions, makes this safe
    // regardless of which convention the browser actually uses, without
    // needing to know which one it is:
    //   - nothing committed yet -> just take it
    //   - the new transcript already starts with everything committed ->
    //     it's the cumulative case; replace, don't append
    //   - what's committed already starts with the new transcript -> the
    //     browser re-sent an old, shorter final; already accounted for,
    //     drop it
    //   - neither contains the other -> genuinely new incremental content;
    //     append it
    function mergeFinal(transcript: string): void {
      const t = transcript.trim()
      if (!t) return
      const committed = committedTextRef.current
      const tLower = t.toLowerCase()
      const committedLower = committed.toLowerCase()
      if (!committed) {
        committedTextRef.current = t
      } else if (tLower.startsWith(committedLower)) {
        committedTextRef.current = t
      } else if (committedLower.startsWith(tLower)) {
        // already fully accounted for — nothing new to add
      } else {
        committedTextRef.current = joinParts(committed, t)
      }
    }

    function renderTranscript(currentInterimText: string): void {
      setValueRef.current(joinParts(baseTextRef.current, committedTextRef.current, currentInterimText))
    }

    function finishSession(): void {
      renderTranscript('')
      setDictating(false)
    }

    recognition.onresult = (event) => {
      if (sessionRef.current === 0) return

      // Scanned from 0, not event.resultIndex — a final result can in
      // principle be reported again in a later event (see mergeFinal's own
      // comment); finalizedIndexesRef is what actually prevents re-merging
      // it, not the scan's own starting point.
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal && !finalizedIndexesRef.current.has(index)) {
          finalizedIndexesRef.current.add(index)
          mergeFinal(result[0]?.transcript ?? '')
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
    committedTextRef.current = ''
    finalizedIndexesRef.current.clear()
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
