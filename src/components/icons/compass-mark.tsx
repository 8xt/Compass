export function CompassMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 700 642.88"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path className="compass-mark-hull" d="M50,321.44 a300,300 0 1,1 600,0 a300,300 0 1,1 -600,0 Z M88,321.44 a262,262 0 1,0 524,0 a262,262 0 1,0 -524,0 Z M338,73.44 h24 v48 h-24 Z M338,521.44 h24 v48 h-24 Z M102,309.44 h48 v24 h-48 Z M550,309.44 h48 v24 h-48 Z M330,321.44 a20,20 0 1,1 40,0 a20,20 0 1,1 -40,0 Z" />
      <path className="compass-mark-sail" d="M494.96,176.48 L386.77,358.21 L313.23,284.67 Z" />
      <path d="M313.23,284.67 L386.77,358.21 L205.04,466.4 Z" />
    </svg>
  );
}
