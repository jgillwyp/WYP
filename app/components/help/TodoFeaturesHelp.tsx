'use client'

import HelpTopicShell from './HelpTopicShell'
import HelpNext from './HelpNext'
import HelpAccountLink from './HelpAccountLink'

/** ToDo Features (2026-09-03) — fourth Help-chip topic, added at Jim's own
 * request ("The three topics work, and add a ToDo features item."). See
 * GettingStartedHelp.tsx's own header comment for the sample-image
 * reasoning; same schematic-SVG approach here. */
export default function TodoFeaturesHelp() {
  return (
    <HelpTopicShell title="ToDo Features">
      <p className="help-lead">
        A ToDo is a Request without a recipient — a personal task, tracked the same way,
        with most of the same power features available to it. Would You Please keeps ToDos
        simple by default, but everything below is one Account Options toggle away.
      </p>

      <div className="panel help-shot">
        <svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ToDo Detail showing Priority, Status, Reminders, Repeat, and Attachments">
          <rect x="0.5" y="0.5" width="399" height="249" rx="10" fill="#fff" stroke="#E2E6EC" />
          <rect x="0.5" y="0.5" width="399" height="30" rx="10" fill="#2A5FC8" />
          <rect x="0.5" y="20" width="399" height="10.5" fill="#2A5FC8" />
          <text x="200" y="20" fill="#fff" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">ToDo Detail</text>

          <text x="16" y="46" fill="#5A6675" fontSize="9" fontFamily="Arial, sans-serif">Priority</text>
          <rect x="16" y="50" width="46" height="16" rx="8" fill="#2A5FC8" />
          <text x="39" y="61" fill="#fff" fontSize="8" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">ASAP</text>
          <rect x="66" y="50" width="50" height="16" rx="8" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="91" y="61" fill="#5A6675" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">SOON</text>
          <rect x="120" y="50" width="52" height="16" rx="8" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="146" y="61" fill="#5A6675" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">LATER</text>

          <rect x="16" y="76" width="368" height="26" rx="6" fill="#fff" stroke="#2A5FC8" strokeWidth="1.5" />
          <text x="24" y="93" fill="#1F2933" fontSize="10.5" fontFamily="Arial, sans-serif">Call the vet about Milo&rsquo;s checkup</text>

          {/* Status chips */}
          <text x="16" y="118" fill="#5A6675" fontSize="9" fontFamily="Arial, sans-serif">Status</text>
          <rect x="16" y="122" width="52" height="16" rx="8" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="42" y="133" fill="#5A6675" fontSize="8" textAnchor="middle" fontFamily="Arial, sans-serif">Open</text>
          <rect x="72" y="122" width="52" height="16" rx="8" fill="#2A5FC8" />
          <text x="98" y="133" fill="#fff" fontSize="8" fontWeight="700" textAnchor="middle" fontFamily="Arial, sans-serif">Done</text>

          {/* Reminders */}
          <rect x="16" y="146" width="368" height="30" rx="6" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="24" y="159" fill="#1F2933" fontSize="9.5" fontWeight="700" fontFamily="Arial, sans-serif">Reminders until Done</text>
          <rect x="24" y="164" width="9" height="9" rx="2" fill="#2A5FC8" />
          <text x="38" y="172" fill="#1F2933" fontSize="8.5" fontFamily="Arial, sans-serif">Day before</text>
          <rect x="112" y="164" width="9" height="9" rx="2" fill="#fff" stroke="#7E8A9A" />
          <text x="126" y="172" fill="#1F2933" fontSize="8.5" fontFamily="Arial, sans-serif">Day of</text>
          <rect x="188" y="164" width="9" height="9" rx="2" fill="#fff" stroke="#7E8A9A" />
          <text x="202" y="172" fill="#1F2933" fontSize="8.5" fontFamily="Arial, sans-serif">Day after</text>

          {/* Conversion banner */}
          <rect x="16" y="184" width="368" height="20" rx="6" fill="#EDF2FD" />
          <text x="24" y="198" fill="#2A5FC8" fontSize="9" fontWeight="700" fontFamily="Arial, sans-serif">Create a Request from this ToDo</text>

          <rect x="16" y="210" width="368" height="20" rx="6" fill="#F6F7F9" stroke="#E2E6EC" />
          <text x="24" y="224" fill="#1F2933" fontSize="9" fontFamily="Arial, sans-serif">Attachments (optional, 100 MB total)</text>
        </svg>
        <span className="help-shot-cap">ToDo Detail — Priority, Status, Reminders, Repeat, and Attachments</span>
      </div>

      <h2>Simple by Default</h2>
      <p>
        Every ToDo has a Priority — ASAP, SOON, or LATER — and an optional Description. Turn on{' '}
        <b>Show Private Category (ToDos)</b>{' '}
        in Account Options to add your own label (e.g. &ldquo;Personal Fin,&rdquo;
        &ldquo;Future Dev&rdquo;), visible only to you.
      </p>

      <h2>Status, or Due/Done Dates — Your Choice</h2>
      <p>
        By default a ToDo shows a simple <b>Open/Done</b> Status chip. Turn on{' '}
        <b>Show Due/Done Dates (ToDos)</b>{' '}
        in Account Options if you&rsquo;d rather track an actual Due Date and Done Date, the
        same way Requests do — that also unlocks Reminders and the Overdue chip for ToDos.
      </p>

      <h2>Reminders and Repeat for ToDos</h2>
      <p>
        With Due/Done Dates on, a ToDo gets the same <b>Day before / Day of / Day after</b>{' '}
        Reminder emails a Request does, sent to you. Turn on{' '}
        <b>Add Reminders (ToDos)</b>{' '}
        in Account Options to use them, and set your own defaults there too. <b>Repeat</b>{' '}
        works on ToDos exactly like it does on Requests — up to 5 occurrences free, unlimited
        for subscribers — handy for anything you do on a recurring basis (watering plants, a
        weekly check-in).
      </p>

      <h2>Attachments</h2>
      <p>
        ToDos can carry file attachments too — a photo, a document, a reference file — with a
        storage allowance based on free or subscription account status.
      </p>

      <h2>Turn a ToDo into a Request (and Back)</h2>
      <p>
        Already tracking something as a ToDo that really needs someone else&rsquo;s help? Use the{' '}
        <b>Create a Request from this ToDo</b>{' '}
        banner at the bottom of ToDo Detail — it carries over the Description, Category, and Due
        Date, and can optionally mark the ToDo Done and Archive it, and copy its Dialog and
        Attachments, all in one step. The same works the other direction from a
        Request&rsquo;s own Detail screen.
      </p>

      <HelpNext current="todo-features" />
      <HelpAccountLink section="todo" label="See Account Options to Personalize ToDos" />
    </HelpTopicShell>
  )
}
