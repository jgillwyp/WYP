// Shared topic list for the four Help-chip screens (2026-09-03) — one place
// naming each topic's route + title, so the "what to try next" nav at the
// bottom of every topic (see HelpNextLink below) can't drift out of sync
// with MainScreen.tsx's own Help-tab rows or the route folders themselves.
export const HELP_TOPICS = [
  { slug: 'getting-started', title: 'Getting Started' },
  { slug: 'creating-a-request', title: 'Creating a Request' },
  { slug: 'responding-to-a-request', title: 'Responding to a Request' },
  { slug: 'todo-features', title: 'ToDo Features' },
] as const

export type HelpTopicSlug = (typeof HELP_TOPICS)[number]['slug']

export function nextHelpTopic(slug: HelpTopicSlug) {
  const i = HELP_TOPICS.findIndex((t) => t.slug === slug)
  return HELP_TOPICS[(i + 1) % HELP_TOPICS.length]
}
