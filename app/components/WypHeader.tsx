/**
 * Header band (§6.8) — logo lockup + wordmark + tagline.
 * Shared by every screen; the SVG lives here so there is exactly one copy.
 */
export default function WypHeader() {
  return (
    <div className="hdr">
      <span className="logo" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="16 8 212 200">
          <g>
            <path
              d="M 52,22 H 156 A 24 24 0 0 1 180,46 V 138 A 24 24 0 0 1 156,162 H 86 L 44,198 L 52,162 A 24 24 0 0 1 28,138 V 46 A 24 24 0 0 1 52,22 Z"
              fill="#FFFFFF"
              stroke="#2A5FC8"
              strokeWidth="11"
              strokeLinejoin="round"
            />
            <rect x="52" y="46" width="104" height="11" rx="5.5" fill="#A7BCE8" />
            <rect x="52" y="70" width="104" height="11" rx="5.5" fill="#A7BCE8" />
            <rect x="52" y="94" width="76" height="11" rx="5.5" fill="#A7BCE8" />
            <rect x="52" y="118" width="58" height="11" rx="5.5" fill="#A7BCE8" />
            <polyline
              points="104,122 140,158 210,52"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="40"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="104,122 140,158 210,52"
              fill="none"
              stroke="#1A3A75"
              strokeWidth="24"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      </span>
      <span className="brand">
        <span className="word">Would You Please</span>
        <span className="tag">Tracking Requests and ToDos</span>
      </span>
    </div>
  )
}
