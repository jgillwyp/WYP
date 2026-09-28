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

type SpeechRecognitionErrorEventLike = { error?: string }

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
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

// How long a pause has to last, total, before dictation actually turns off
// — see armSilenceTimer's own comment below for why this is a real JS
// timer layered on top of (not a replacement for) the browser's own much
// shorter internal pause timeout.
const SILENCE_TIMEOUT_MS = 4000

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
  // silenceTimerRef (2026-09-28, revised same day — see armSilenceTimer's
  // own comment below) drives the actual 4-second decision directly via a
  // real JS timer, rather than comparing elapsed time at whatever moment
  // the browser's own onend happens to fire. armSilenceTimerRef exists
  // purely so toggle() (outside the setup effect below, which is where
  // the recognition instance itself lives) can arm the same timer.
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armSilenceTimerRef = useRef<(() => void) | null>(null)
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

    // Tracks whatever interim (not-yet-final) text was on screen as of the
    // last onresult event — read by handleEnd below so a restart (see its
    // own comment) doesn't silently lose the last word or two the user was
    // mid-saying exactly when the browser cut the session off.
    let lastInterimText = ''

    function renderTranscript(currentInterimText: string): void {
      lastInterimText = currentInterimText
      setValueRef.current(joinParts(baseTextRef.current, committedTextRef.current, currentInterimText))
    }

    function finishSession(): void {
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      renderTranscript('')
      setDictating(false)
    }

    // Owner-reported, 2026-09-28 (same day as the staircase fix above, but
    // unrelated to it — nothing above touches session timing): a brief
    // hesitation (his own estimate, "only a 1 second hesitation") was
    // turning dictation off entirely. Confirmed he likes the auto-turn-off
    // itself, just wanted more grace before it fires — landed on 4 seconds
    // (SILENCE_TIMEOUT_MS above). Revised again same day: an earlier
    // version of this fix compared elapsed time only at whatever moment
    // the browser's own onend happened to fire, which meant the real
    // grace period depended on how many of the browser's own short
    // restart cycles it took to reach 4 seconds — and how reliably each
    // one actually restarted, which turned out not to be reliable enough
    // (owner-reported: the delay was longer than before but stopping
    // early, around 2 seconds). A real setTimeout, armed fresh on every
    // burst of speech and re-armed by toggle() when dictation first
    // starts, is authoritative regardless of how the browser itself
    // behaves in between — it fires at exactly 4000ms of no qualifying
    // reset, once, and that firing is what actually stops recognition
    // (see armSilenceTimer below), not a check made only when onend
    // happens to occur.
    //
    // The Web Speech API gives no standard, cross-browser way to
    // configure the browser's own internal pause threshold directly —
    // it's the browser/OS's own speech endpointer, outside this
    // codebase's control even with `continuous = true` set (some
    // implementations honor `continuous` loosely and end the underlying
    // session on a pause anyway, most commonly signaled as an `onerror`
    // with `error: 'no-speech'`, followed by `onend`). What IS
    // controllable is how this hook reacts to that short browser-imposed
    // cutoff: restart listening every time, and let the independent
    // 4-second timer be the only thing that decides when to actually
    // stop. baseTextRef/committedTextRef/finalizedIndexesRef are untouched
    // by a restart (only toggle()'s own explicit-start path clears them),
    // so whatever was already dictated stays exactly as rendered.
    function isRecoverableError(errorCode: string | undefined): boolean {
      return errorCode === 'no-speech'
    }

    // armSilenceTimer re-arms the real 4-second stop timer — called from
    // onresult on every burst of speech (interim or final) and once from
    // toggle() when dictation first starts, via armSilenceTimerRef. Its
    // own firing is the ONLY thing that sets sessionRef.current = 0 while
    // still dictating (besides an explicit user stop or a fatal error) —
    // everything else (a short browser-imposed onend) just restarts.
    function armSilenceTimer(): void {
      if (silenceTimerRef.current !== null) clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null
        sessionRef.current = 0
        try {
          recognition.stop()
        } catch {
          finishSession()
        }
      }, SILENCE_TIMEOUT_MS)
    }
    armSilenceTimerRef.current = armSilenceTimer

    // sessionRef.current === 0 only when toggle()'s own stop path zeroed
    // it first, a non-recoverable onerror doing the same, or the silence
    // timer above firing — that's the one case this actually finishes
    // outright. Any other time onend fires, it's just the browser ending
    // the underlying session on its own short internal timeout; restart
    // unconditionally and let the independent timer be the only thing
    // that decides when enough real silence has actually passed. A
    // start() that throws (e.g. called too soon after the previous
    // instance tore down) falls back to finishing rather than risking a
    // silently broken, visibly-still-on mic button.
    function handleEnd(): void {
      if (sessionRef.current === 0) {
        finishSession()
        return
      }
      // Fold in whatever was still interim (never finalized) at the exact
      // moment the browser cut the session off — otherwise the next
      // session's own first render would silently overwrite it, since
      // renderTranscript always replaces the whole value from scratch.
      if (lastInterimText) {
        mergeFinal(lastInterimText)
        lastInterimText = ''
      }
      // A restarted recognition instance numbers its own results from 0
      // again — finalizedIndexesRef has to reset with it, or the new
      // session's own index 0/1/2… reads as "already merged" and its real
      // speech is silently dropped. committedTextRef (the actual
      // accumulated text) is untouched — only the per-session index
      // bookkeeping resets.
      finalizedIndexesRef.current.clear()
      try {
        recognition.start()
      } catch {
        finishSession()
      }
    }

    recognition.onresult = (event) => {
      if (sessionRef.current === 0) return

      // Any onresult event means the recognizer is actively hearing
      // something — re-arms the real 4-second stop timer.
      armSilenceTimer()

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
    recognition.onerror = (event) => {
      // A recoverable error (currently just 'no-speech') is deliberately
      // left as a no-op here — the onend that follows it is what actually
      // decides to restart-or-finish (handleEnd above), so there's exactly
      // one place making that call rather than two paths that could
      // disagree.
      if (sessionRef.current !== 0 && isRecoverableError(event?.error)) return
      // A real error ('not-allowed', 'audio-capture', etc.) — zero
      // sessionRef before finishing, same signal toggle()'s own explicit
      // stop path already sets, so the onend that follows this (browsers
      // fire both) sees sessionRef.current === 0 and finishes cleanly too
      // instead of trying to restart a recognizer that just failed for a
      // reason a restart can't fix.
      sessionRef.current = 0
      finishSession()
    }
    recognition.onend = handleEnd
    recognitionRef.current = recognition

    queueMicrotask(() => setSupported(true))

    return () => {
      sessionRef.current = 0
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      recognition.stop()
      recognitionRef.current = null
    }
  }, [])

  function toggle(): void {
    const recognition = recognitionRef.current
    if (!recognition) return

    if (dictating) {
      sessionRef.current = 0
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
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
      // Starts the real 4-second countdown immediately — otherwise a
      // dictation session opened and then never spoken into at all would
      // sit listening forever instead of timing out like every other
      // silence does.
      armSilenceTimerRef.current?.()
    } catch {
      sessionRef.current = 0
      setDictating(false)
    }
  }

  return { supported, dictating, toggle }
}
