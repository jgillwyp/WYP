'use client'

import { useState } from 'react'
import type { ChangeEvent, ClipboardEvent } from 'react'

import { isAndroidDevice, isIOSDevice, isMacOSDevice } from './platform'

// Image attachments for the Feedback dialog (2026-11-22) — Jim: "add the
// ability to paste captured images into the feedback email dialog... a
// short platform-specific explanation for how to capture screen images."
// A screenshot captured with a desktop tool (Win+Shift+S, Cmd+Shift+4)
// lands straight on the clipboard, so paste is the natural path there; a
// phone's own screenshot (Side+Volume Up on iOS, Power+Volume Down on
// Android) only ever saves to Photos/Gallery, never the clipboard, so the
// file picker is the real path on mobile — hence both are offered, with
// one platform-tailored hint explaining whichever one actually applies.
//
// Shared as a hook (not a shared component) rather than duplicated per
// file, same precedent as this app's own useSpeechDictation.ts: the logic
// (file reading, validation, paste handling) is meaty and identical by
// both callers, while each dialog's own surrounding JSX/markup stays
// duplicated per this codebase's usual per-file convention.
//
// Images are kept as data URLs in memory only, sent to the server as part
// of the same JSON POST the message itself already uses, and never stored
// anywhere — matching /api/feedback/send's own existing "no stored record
// of a submission" design. The cap below is a courtesy; the real limit is
// re-enforced server-side.
export type FeedbackImage = {
  filename: string
  contentType: string
  dataUrl: string
}

export const FEEDBACK_MAX_IMAGES = 3
export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB per image, raw

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// isIOSDevice()/isAndroidDevice()/isMacOSDevice() are safe to call directly
// here (no mount-effect/microtask deferral needed) — this hook is only ever
// instantiated by a dialog component, and the hint text it returns is only
// ever rendered once that dialog is actually open, same reasoning
// AddToCalendarAlarmsDialog.tsx's own guidance text already established.
function screenshotHint(): string {
  if (isIOSDevice()) {
    return 'On iPhone/iPad: press the Side button + Volume Up to capture the screen, then tap "Attach Screenshot" below and choose it from Photos.'
  }
  if (isAndroidDevice()) {
    return 'On Android: press Power + Volume Down to capture the screen, then tap "Attach Screenshot" below and choose it from your Gallery.'
  }
  if (isMacOSDevice()) {
    return 'On Mac: press Cmd+Shift+4 to capture an area — it copies to your clipboard, so you can just paste it (Cmd+V) into the message above.'
  }
  return 'On Windows: press Win+Shift+S to capture an area — it copies to your clipboard, so you can just paste it (Ctrl+V) into the message above.'
}

// Deliberately returns no ref of its own (the hidden file input's trigger
// button needs one, but it's kept local to each caller rather than bundled
// into this hook's own returned object) — ESLint's react-hooks/refs rule
// treats a returned object as ref-tainted as a whole once any property on
// it is a ref, which would then flag every other plain-value access on
// `feedbackImages.*` in render as an illegal ref read.
export function useFeedbackImages() {
  const [images, setImages] = useState<FeedbackImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hint] = useState(() => screenshotHint())

  async function addFile(file: File) {
    if (!file.type.startsWith('image/')) return
    if (images.length >= FEEDBACK_MAX_IMAGES) {
      setError(`You can attach up to ${FEEDBACK_MAX_IMAGES} images.`)
      return
    }
    if (file.size > FEEDBACK_MAX_IMAGE_BYTES) {
      setError('That image is too large (5 MB max) — try a smaller capture.')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setImages((current) => [
        ...current,
        { filename: file.name || `screenshot-${current.length + 1}.png`, contentType: file.type, dataUrl },
      ])
      setError(null)
    } catch {
      setError('Could not read that image — please try again.')
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          void addFile(file)
        }
      }
    }
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files) {
      Array.from(files).forEach((f) => void addFile(f))
    }
    e.target.value = ''
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, i) => i !== index))
    setError(null)
  }

  function reset() {
    setImages([])
    setError(null)
  }

  return { images, error, hint, handlePaste, handleFileInputChange, removeImage, reset }
}
